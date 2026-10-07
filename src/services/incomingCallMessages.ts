import { isCurrentPushRecipient } from "./pushIdentity";
import { clearPendingCallAction, sendRingingAck } from "./incomingCallActions";
import { cancelIncomingCall, displayIncomingCall } from "./incomingCallNotification";

/** Shared by foreground and headless FCM listeners; missing recipients fail closed. */
export async function handleIncomingCallMessage(
  data: Record<string, unknown> | undefined,
  showNotification = true,
): Promise<{ cancelledCallId: string } | undefined> {
  if (!data || !(await isCurrentPushRecipient(data.toUserId))) return;
  const callId = typeof data.callId === "string" ? data.callId : "";
  if (!callId) return;
  if (data.type === "cancel_call") {
    await cancelIncomingCall(callId);
    await clearPendingCallAction(callId);
    if (await isCurrentPushRecipient(data.toUserId)) return { cancelledCallId: callId };
    return;
  }
  if (data.type !== "incoming_call" || typeof data.fromUserId !== "string" || !data.fromUserId) return;
  if (!showNotification) {
    await cancelIncomingCall(callId);
    return;
  }
  try {
    const displayed = await displayIncomingCall({
      callId,
      toUserId: data.toUserId as string,
      fromUserId: data.fromUserId,
      fromDisplayName: typeof data.fromDisplayName === "string" ? data.fromDisplayName : data.fromUserId,
    });
    if (displayed && await isCurrentPushRecipient(data.toUserId)) await sendRingingAck(callId);
  } catch {
    console.warn("[push] incoming call could not be displayed");
  }
}
