import AsyncStorage from "@react-native-async-storage/async-storage";
import { DeviceEventEmitter } from "react-native";
import Constants from "expo-constants";
import type { IncomingCallData } from "./incomingCallNotification";
import { isCurrentPushRecipient, readCachedIdToken } from "./pushIdentity";

const PENDING_KEY = "@privora/pendingCallAction";
export const INCOMING_CALL_EVENT = "privora:incoming-call-action";

/** Emitted in-app when an action button (Answer / Decline) is tapped. */
export type PendingCallAction =
  | { kind: "accept"; payload: IncomingCallData; ts: number }
  | { kind: "decline"; payload: IncomingCallData; ts: number }
  | { kind: "open"; payload: IncomingCallData; ts: number };

type ActionInput = {
  kind: PendingCallAction["kind"];
  payload: IncomingCallData;
};

/**
 * Centralised handler invoked by both the notifee foreground and background
 * event listeners. Persists the user's intent to AsyncStorage so the app
 * can reconcile it on cold start, and emits an in-process event so an
 * already-running app can react immediately.
 */
export async function handleIncomingCallAction({ kind, payload }: ActionInput): Promise<void> {
  if (!(await isCurrentPushRecipient(payload.toUserId))) return;
  const action: PendingCallAction = { kind, payload, ts: Date.now() };

  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(action));
  } catch {
    // best-effort
  }

  try {
    if (!(await isCurrentPushRecipient(payload.toUserId))) return;
    DeviceEventEmitter.emit(INCOMING_CALL_EVENT, action);
  } catch {
    // best-effort
  }

  if (kind === "decline") {
    await sendDeclineToBackend(payload).catch(() => {
      // 45 s server-side timeout will clean up if the HTTP call fails.
    });
    await clearPendingCallAction(payload.callId);
  }
}

export async function readPendingCallAction(): Promise<PendingCallAction | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCallAction;
    if (!parsed || !parsed.kind || !parsed.payload?.callId) return null;
    // Stale actions (older than the call ringing timeout) are not actionable.
    if (Date.now() - (parsed.ts || 0) > 60_000) {
      await clearPendingCallAction(parsed.payload.callId);
      return null;
    }
    if (!(await isCurrentPushRecipient(parsed.payload.toUserId))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPendingCallAction(callId?: string): Promise<void> {
  try {
    if (callId) {
      const raw = await AsyncStorage.getItem(PENDING_KEY);
      if (!raw || JSON.parse(raw)?.payload?.callId !== callId) return;
    }
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

function readApiBaseUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
  return extra.apiBaseUrl || "https://privora-app.com";
}

async function sendDeclineToBackend(payload: IncomingCallData): Promise<void> {
  const token = await readCachedIdToken(payload.toUserId);
  if (!token) return;

  const url = `${readApiBaseUrl()}/api/calls/${encodeURIComponent(payload.callId)}/reject`;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reason: "declined" }),
    });
  } catch {
    // server-side TTL will clean up the call session if this fails.
  }
}

/**
 * Tell the backend that the heads-up incoming-call notification is now
 * on screen so it can flip the caller's UI from "Reaching device..."
 * to "Calling...".
 *
 * This endpoint is intentionally unauthenticated: the only side-effect
 * is a UI label change on the caller side, gated by a UUID `callId`
 * already known to a live session.
 */
export async function sendRingingAck(callId: string): Promise<void> {
  if (!callId) return;
  const url = `${readApiBaseUrl()}/api/calls/${encodeURIComponent(callId)}/ringing`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch {
    // best-effort - the WS-driven call_ring will still flip the caller
    // UI once the device actually reconnects and processes call_offer.
  }
}
