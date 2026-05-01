import notifee, {
  AndroidCategory,
  AndroidColor,
  AndroidImportance,
  AndroidVisibility,
  EventType,
  type Event,
} from "@notifee/react-native";
import { Platform } from "react-native";
import { handleIncomingCallAction } from "./incomingCallActions";

export const INCOMING_CALL_CHANNEL_ID = "incoming_call";
export const INCOMING_CALL_CATEGORY_ID = "privora.incoming_call";
export const NOTIFEE_ACTION_ACCEPT = "accept";
export const NOTIFEE_ACTION_DECLINE = "decline";

export type IncomingCallData = {
  callId: string;
  fromUserId: string;
  fromDisplayName: string;
};

let channelEnsured = false;

async function ensureIncomingCallChannel(): Promise<void> {
  if (Platform.OS !== "android" || channelEnsured) return;
  await notifee.createChannel({
    id: INCOMING_CALL_CHANNEL_ID,
    name: "Incoming calls",
    description: "Used to ring you when someone is calling.",
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    sound: "ringing",
    vibration: true,
    // Notifee requires an even number of *positive* values: alternating
    // (vibrate, wait, vibrate, wait, ...). A leading 0 throws.
    vibrationPattern: [600, 400, 600, 400, 600, 400],
    bypassDnd: true,
    lights: true,
    lightColor: AndroidColor.BLUE,
  });
  channelEnsured = true;
}

function notificationIdFor(callId: string): string {
  return `call:${callId}`;
}

/**
 * Display the rich incoming-call notification with Answer / Decline action
 * buttons and a full-screen intent so it can take over the lock screen on
 * Android. Safe to call from the background message handler.
 */
export async function displayIncomingCall(data: IncomingCallData): Promise<void> {
  await ensureIncomingCallChannel();

  const title = "Incoming call";
  const body = `${data.fromDisplayName || data.fromUserId} is calling…`;
  const dataPayload: Record<string, string> = {
    type: "incoming_call",
    callId: data.callId,
    fromUserId: data.fromUserId,
    fromDisplayName: data.fromDisplayName || "",
  };

  await notifee.displayNotification({
    id: notificationIdFor(data.callId),
    title,
    body,
    data: dataPayload,
    android: {
      channelId: INCOMING_CALL_CHANNEL_ID,
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      smallIcon: "ic_launcher",
      color: "#2563eb",
      colorized: true,
      // Loop the ringtone for as long as the notification is visible.
      loopSound: true,
      // Keep it on screen until the user reacts or the call expires.
      ongoing: true,
      autoCancel: false,
      timeoutAfter: 45_000,
      // Tap-the-body opens the app (which will resume the call via the
      // existing CallOverlay once the WS reconnects).
      pressAction: {
        id: "default",
        launchActivity: "default",
      },
      // Lock-screen takeover.
      fullScreenAction: {
        id: "default",
        launchActivity: "default",
      },
      actions: [
        {
          title: "Answer",
          pressAction: {
            id: NOTIFEE_ACTION_ACCEPT,
            launchActivity: "default",
          },
        },
        {
          title: "Decline",
          pressAction: {
            id: NOTIFEE_ACTION_DECLINE,
          },
        },
      ],
    },
    ios: {
      categoryId: INCOMING_CALL_CATEGORY_ID,
      sound: "ringing.caf",
      critical: true,
    },
  });
}

/** Cancel the call notification by callId. Safe to call multiple times. */
export async function cancelIncomingCall(callId: string): Promise<void> {
  try {
    await notifee.cancelNotification(notificationIdFor(callId));
  } catch {
    // ignore
  }
}

/** Cancel any incoming-call notifications currently displayed. */
export async function cancelAllIncomingCalls(): Promise<void> {
  try {
    const displayed = await notifee.getDisplayedNotifications();
    await Promise.all(
      displayed
        .filter((n) => n.notification?.data?.type === "incoming_call")
        .map((n) => (n.notification?.id ? notifee.cancelNotification(n.notification.id) : Promise.resolve())),
    );
  } catch {
    // ignore
  }
}

/**
 * Set up the iOS notification category once. On Android the channel +
 * `actions` array on each notification is enough.
 */
export async function setupIncomingCallCategory(): Promise<void> {
  if (Platform.OS !== "ios") return;
  await notifee.setNotificationCategories([
    {
      id: INCOMING_CALL_CATEGORY_ID,
      actions: [
        {
          id: NOTIFEE_ACTION_ACCEPT,
          title: "Answer",
          foreground: true,
        },
        {
          id: NOTIFEE_ACTION_DECLINE,
          title: "Decline",
          destructive: true,
        },
      ],
    },
  ]);
}

function payloadFromEvent(event: Event): IncomingCallData | null {
  const data = event.detail.notification?.data as Record<string, unknown> | undefined;
  if (!data || data.type !== "incoming_call") return null;
  const callId = typeof data.callId === "string" ? data.callId : "";
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId : "";
  const fromDisplayName = typeof data.fromDisplayName === "string" ? data.fromDisplayName : "";
  if (!callId || !fromUserId) return null;
  return { callId, fromUserId, fromDisplayName: fromDisplayName || fromUserId };
}

/**
 * Process a Notifee event - identical handling whether it fires from the
 * foreground or the background. Returns true when the event was consumed.
 */
export async function handleIncomingCallEvent(event: Event): Promise<boolean> {
  if (event.type !== EventType.ACTION_PRESS && event.type !== EventType.PRESS) {
    return false;
  }

  const payload = payloadFromEvent(event);
  if (!payload) return false;

  const actionId = event.detail.pressAction?.id;
  if (event.type === EventType.PRESS) {
    // Body tap: open the app and let the WS-driven CallOverlay take over.
    await handleIncomingCallAction({ kind: "open", payload });
    return true;
  }

  if (actionId === NOTIFEE_ACTION_DECLINE) {
    await handleIncomingCallAction({ kind: "decline", payload });
    await cancelIncomingCall(payload.callId);
    return true;
  }

  if (actionId === NOTIFEE_ACTION_ACCEPT) {
    await handleIncomingCallAction({ kind: "accept", payload });
    await cancelIncomingCall(payload.callId);
    return true;
  }

  return false;
}
