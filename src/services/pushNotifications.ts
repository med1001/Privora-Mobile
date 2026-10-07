import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import messaging from "@react-native-firebase/messaging";
import { registerPushToken, unregisterPushToken } from "./api";
import { setPushRecipient, cacheIdToken, normalizeRecipient } from "./pushIdentity";
import { clearPendingCallAction } from "./incomingCallActions";
import { cancelAllIncomingCalls } from "./incomingCallNotification";

/**
 * Push registration for incoming-call notifications.
 *
 * The actual notification UI (sound, channel, Answer/Decline buttons,
 * full-screen intent) is rendered by Notifee via
 * `src/services/incomingCallNotification.ts`. The data-only FCM message is
 * received by `@react-native-firebase/messaging`'s background handler in
 * `index.ts`, and by `useIncomingCallBridge` while the app is in the
 * foreground.
 *
 * This module is responsible for:
 *  - asking the user for notification permission
 *  - obtaining the device's FCM token
 *  - sending the token to the backend so it knows where to deliver pushes
 *
 * IMPORTANT: requires `google-services.json` at the repo root and a build
 * with `@react-native-firebase/app` enabled. See
 * `docs/push-notifications-setup.md`.
 */

type PushAccount = { uid: string; email: string | null; getIdToken: () => Promise<string> };
type Session = { account: PushAccount; deviceToken?: string; registered: boolean; ready: Promise<void> };
let active: Session | null = null;
let mutations: Promise<unknown> = Promise.resolve();
export const PUSH_TIMEOUT_MS = 8_000;

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutations.then(operation);
  mutations = result.catch(() => undefined);
  return result;
}

async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Push operation timed out"));
        }, PUSH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Establish identity before exposing the authenticated UI. No network wait. */
export async function startPushSession(account: PushAccount): Promise<void> {
  if (active?.account.uid === account.uid) return active.ready;
  const previous = active;
  const recipient = normalizeRecipient(account.email);
  const ready = setPushRecipient(recipient || null);
  const session: Session = { account, registered: false, ready };
  active = session;
  if (previous) {
    // Preserve a cold-start Answer for the same restored user, but never for
    // an in-process account switch. Network cleanup precedes B registration.
    void enqueue(() => removeRegistration(previous));
    session.ready = ready.then(async () => {
      await Promise.all([clearPendingCallAction(), cancelAllIncomingCalls()]);
    });
  }
  await session.ready;
}

async function removeRegistration(session: Session): Promise<void> {
  try {
    await bounded(async (signal) => {
      const deviceToken = session.deviceToken ?? await getDeviceTokenAsync();
      if (!deviceToken || signal.aborted) return;
      const token = await session.account.getIdToken();
      if (signal.aborted) return;
      await unregisterPushToken(token, deviceToken, signal);
    });
  } catch {
    // Offline/revoked credentials: local recipient filtering remains active.
    console.warn("[push] unregister unavailable; local session cleared");
  }
}

/** Invalidate immediately; finish best-effort unregister before Firebase signOut. */
export function stopPushSession(): Promise<void> {
  const previous = active;
  active = null;
  const cleanup = Promise.allSettled([
    setPushRecipient(null), clearPendingCallAction(), cancelAllIncomingCalls(),
  ]);
  return enqueue(async () => {
    await cleanup;
    if (previous) await removeRegistration(previous);
  });
}

async function requestPermissionsAsync(): Promise<boolean> {
  if (!Device.isDevice && Platform.OS !== "ios") {
    // Android emulators do not deliver real FCM messages, but the API
    // still works for local development. Keep going so devs can exercise
    // the registration flow.
  }

  // Use messaging().requestPermission for parity with the foreground/background handlers.
  // expo-notifications.requestPermissionsAsync is also kept so the system
  // permission dialog wording is correct on Android 13+.
  try {
    const status = await messaging().requestPermission();
    if (
      status === messaging.AuthorizationStatus.AUTHORIZED ||
      status === messaging.AuthorizationStatus.PROVISIONAL
    ) {
      return true;
    }
  } catch {
    // Fall back to expo-notifications below.
  }

  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }
  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
      provideAppNotificationSettings: false,
      allowProvisional: true,
    },
  });
  return (
    requested.granted ||
    requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

async function getDeviceTokenAsync(): Promise<string | null> {
  try {
    if (Platform.OS === "ios") {
      // On iOS we need the APNs token registered first; messaging().getToken()
      // handles this internally.
      await messaging().registerDeviceForRemoteMessages();
    }
    const token = await messaging().getToken();
    if (typeof token === "string" && token.length > 0) {
      return token;
    }
  } catch (err) {
    if (Constants?.executionEnvironment === "storeClient") {
      console.info("[push] device tokens are not available in Expo Go");
    } else {
      console.warn("[push] messaging().getToken() failed", err);
    }
  }
  return null;
}

/** Retry on login/foreground. Cache belongs to this exact authenticated session. */
export function registerPushNotifications(): Promise<boolean> {
  const session = active;
  if (!session) return Promise.resolve(false);
  return enqueue(async () => {
    if (active !== session) return false;
    try {
      return await bounded(async (signal) => {
        await session.ready;
        if (!normalizeRecipient(session.account.email)) return false;
        if (!(await requestPermissionsAsync())) return false;
        if (active !== session || signal.aborted) return false;
        const deviceToken = await getDeviceTokenAsync();
        if (!deviceToken || active !== session || signal.aborted) return false;
        if (session.deviceToken === deviceToken && session.registered) return true;
        const idToken = await session.account.getIdToken();
        if (active !== session || signal.aborted) return false;
        await cacheIdToken(idToken, session.account.email!);
        if (active !== session || signal.aborted) return false;
        // Remember an attempted registration even if the response is lost.
        session.deviceToken = deviceToken;
        await registerPushToken(idToken, deviceToken, Platform.OS === "ios" ? "ios" : "android", signal);
        if (active !== session || signal.aborted) return false;
        session.registered = true;
        return true;
      });
    } catch {
      console.warn("[push] registration unavailable; will retry on foreground/login");
      return false;
    }
  });
}
