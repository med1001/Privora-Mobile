import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import messaging from "@react-native-firebase/messaging";
import { registerPushToken, unregisterPushToken } from "./api";

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

let cachedDeviceToken: string | null = null;
let registeredOnBackend = false;

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

/**
 * Idempotent: safe to call from a `useEffect` on every login. Returns
 * true when a token was successfully registered with the backend.
 */
export async function registerPushNotifications(getIdToken: () => Promise<string>): Promise<boolean> {
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
    await registerPushToken(idToken, deviceToken, Platform.OS === "ios" ? "ios" : "android");
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
