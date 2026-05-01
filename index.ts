import { registerRootComponent } from "expo";
import notifee, { EventType, type Event } from "@notifee/react-native";
import messaging, { type FirebaseMessagingTypes } from "@react-native-firebase/messaging";
import {
  cancelIncomingCall,
  displayIncomingCall,
  handleIncomingCallEvent,
  type IncomingCallData,
} from "./src/services/incomingCallNotification";
import {
  clearPendingCallAction,
  sendRingingAck,
} from "./src/services/incomingCallActions";

import App from "./App";

function parseIncomingCallPayload(
  data: FirebaseMessagingTypes.RemoteMessage["data"] | undefined,
): IncomingCallData | null {
  if (!data || data.type !== "incoming_call") return null;
  const callId = typeof data.callId === "string" ? data.callId : "";
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId : "";
  const fromDisplayName = typeof data.fromDisplayName === "string" ? data.fromDisplayName : "";
  if (!callId || !fromUserId) return null;
  return {
    callId,
    fromUserId,
    fromDisplayName: fromDisplayName || fromUserId,
  };
}

// FCM data-only messages run this handler in a headless JS instance even
// when the app is killed. We dispatch on the `type` field:
//   - "incoming_call": render the rich Notifee notification with
//     Answer / Decline actions + full-screen intent and tell the backend
//     "I'm ringing" so the caller's UI flips from "Reaching device..."
//     to "Calling..." with ringtone.
//   - "cancel_call": the caller hung up before pickup (or another
//     device of ours answered) - dismiss any active heads-up and clear
//     pending actions so a stale auto-accept doesn't fire later.
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  const data = remoteMessage?.data;
  const type = data && typeof data.type === "string" ? data.type : "";

  if (type === "cancel_call") {
    const callId = typeof data?.callId === "string" ? data.callId : "";
    if (callId) {
      try {
        await cancelIncomingCall(callId);
      } catch (err) {
        console.warn("[fcm-bg] failed to cancel incoming call", err);
      }
      try {
        await clearPendingCallAction();
      } catch {
        // best-effort
      }
    }
    return;
  }

  const payload = parseIncomingCallPayload(data);
  if (!payload) return;
  try {
    await displayIncomingCall(payload);
  } catch (err) {
    console.warn("[fcm-bg] failed to display incoming call", err);
  }
  // Best-effort ack to flip the caller's UI to "Calling..." now that
  // the heads-up is on screen. Done after displayIncomingCall so that a
  // notification rendering failure doesn't lie to the caller.
  try {
    await sendRingingAck(payload.callId);
  } catch {
    // ignore - caller will fall back to plain "calling_remote" until the
    // WS-driven call_ring arrives once the user opens the app.
  }
});

// Notifee dispatches this in headless mode when the user taps an action
// button on the lock screen / heads-up notification (Android only).
notifee.onBackgroundEvent(async (event: Event) => {
  if (event.type !== EventType.ACTION_PRESS && event.type !== EventType.PRESS) return;
  try {
    await handleIncomingCallEvent(event);
  } catch (err) {
    console.warn("[notifee-bg] event handler failed", err);
  }
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
