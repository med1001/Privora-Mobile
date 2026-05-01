import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { registerPushToken, unregisterPushToken } from "./api";

/**
 * Push notifications used for incoming-call alerts. We rely on the device's
 * native FCM token (via `getDevicePushTokenAsync`) so the backend can talk
 * straight to FCM through the firebase-admin SDK it already initialises -
 * no Expo push proxy is involved.
 *
 * IMPORTANT: For physical Android devices to receive these tokens, the app
 * must be built as a development/production build (not Expo Go) AND the
 * Firebase project's `google-services.json` must be present at
 * `android/app/google-services.json`. See `docs/push-notifications-setup.md`.
 */

export const INCOMING_CALL_CHANNEL_ID = "incoming_call";

let cachedDeviceToken: string | null = null;
let registeredOnBackend = false;

const RESPONSE_LISTENERS = new Set<(payload: IncomingCallPayload) => void>();

export type IncomingCallPayload = {
  callId: string;
  fromUserId: string;
  fromDisplayName: string;
};

let responseSubscription: Notifications.Subscription | null = null;
let receivedSubscription: Notifications.Subscription | null = null;

function configureForegroundHandler() {
  // Make sure the OS shows our incoming-call alert even if the app happens
  // to be in the foreground - the in-app CallOverlay will take over once
  // the WebSocket signal arrives, but we still want the user to get an
  // immediate audible notification.
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data as Record<string, unknown> | null;
      const isCall = data?.type === "incoming_call";
      return {
        shouldShowAlert: !!isCall,
        shouldPlaySound: !!isCall,
        shouldSetBadge: false,
        shouldShowBanner: !!isCall,
        shouldShowList: !!isCall,
      };
    },
  });
}

async function ensureIncomingCallChannel() {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(INCOMING_CALL_CHANNEL_ID, {
      name: "Incoming calls",
      description: "Used to ring you when someone is calling.",
      importance: Notifications.AndroidImportance.MAX,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      enableVibrate: true,
      vibrationPattern: [0, 600, 400, 600, 400, 600],
      sound: "ringing",
      lightColor: "#2563eb",
    });
  } catch (err) {
    console.warn("[push] failed to set up incoming-call channel", err);
  }
}

function extractCallPayload(notification: Notifications.NotificationResponse): IncomingCallPayload | null {
  const data = notification.notification.request.content.data as Record<string, unknown> | null;
  if (!data || data.type !== "incoming_call") return null;
  const callId = typeof data.callId === "string" ? data.callId : "";
  const fromUserId = typeof data.from === "string" ? data.from : "";
  const fromDisplayName =
    (typeof data.fromDisplayName === "string" && data.fromDisplayName) ||
    fromUserId ||
    "Unknown caller";
  if (!callId || !fromUserId) return null;
  return { callId, fromUserId, fromDisplayName };
}

function emitCallPayload(payload: IncomingCallPayload | null) {
  if (!payload) return;
  RESPONSE_LISTENERS.forEach((listener) => {
    try {
      listener(payload);
    } catch (err) {
      console.warn("[push] listener threw", err);
    }
  });
}

function ensureSubscriptions() {
  if (!responseSubscription) {
    responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      emitCallPayload(extractCallPayload(response));
    });
  }
  if (!receivedSubscription) {
    receivedSubscription = Notifications.addNotificationReceivedListener(() => {
      // No-op for now. The OS already played the alert; foreground UI is
      // driven by the WebSocket signal.
    });
  }
}

export function onIncomingCallNotification(listener: (payload: IncomingCallPayload) => void): () => void {
  RESPONSE_LISTENERS.add(listener);
  ensureSubscriptions();
  return () => {
    RESPONSE_LISTENERS.delete(listener);
  };
}

async function requestPermissionsAsync(): Promise<boolean> {
  if (!Device.isDevice && Platform.OS !== "ios") {
    // Android emulators do not deliver real FCM messages, but the API still
    // works for local testing. We'll keep going on emulators so devs can
    // exercise the registration flow.
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
    const result = await Notifications.getDevicePushTokenAsync();
    if (typeof result.data === "string" && result.data.length > 0) {
      return result.data;
    }
    if (result.data && typeof result.data === "object" && "token" in result.data) {
      const value = (result.data as { token?: unknown }).token;
      return typeof value === "string" ? value : null;
    }
  } catch (err) {
    // Most common reason this throws on Android: google-services.json is
    // missing or the Firebase Cloud Messaging API is not enabled. We log
    // once so the developer can fix it without spamming.
    if (Constants?.executionEnvironment === "storeClient") {
      console.info("[push] device tokens are not available in Expo Go");
    } else {
      console.warn("[push] getDevicePushTokenAsync failed", err);
    }
  }
  return null;
}

/**
 * Idempotent: safe to call from a `useEffect` on every login. Returns true
 * when a token was successfully registered with the backend.
 */
export async function registerPushNotifications(getIdToken: () => Promise<string>): Promise<boolean> {
  configureForegroundHandler();
  await ensureIncomingCallChannel();
  ensureSubscriptions();

  const granted = await requestPermissionsAsync();
  if (!granted) {
    return false;
  }

  const deviceToken = await getDeviceTokenAsync();
  if (!deviceToken) {
    return false;
  }

  if (cachedDeviceToken === deviceToken && registeredOnBackend) {
    return true;
  }

  try {
    const idToken = await getIdToken();
    await registerPushToken(idToken, deviceToken, (Platform.OS === "ios" ? "ios" : "android"));
    cachedDeviceToken = deviceToken;
    registeredOnBackend = true;
    return true;
  } catch (err) {
    console.warn("[push] failed to register token with backend", err);
    return false;
  }
}

/** Tell the backend to forget this device's token (call on logout). */
export async function unregisterPushNotifications(getIdToken: () => Promise<string>): Promise<void> {
  const token = cachedDeviceToken;
  cachedDeviceToken = null;
  registeredOnBackend = false;
  if (!token) return;
  try {
    const idToken = await getIdToken();
    await unregisterPushToken(idToken, token);
  } catch (err) {
    console.warn("[push] failed to unregister token", err);
  }
}

export async function teardownPushNotifications() {
  if (responseSubscription) {
    responseSubscription.remove();
    responseSubscription = null;
  }
  if (receivedSubscription) {
    receivedSubscription.remove();
    receivedSubscription = null;
  }
  RESPONSE_LISTENERS.clear();
}
