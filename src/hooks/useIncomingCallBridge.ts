import { useEffect, useRef, useState } from "react";
import { AppState, DeviceEventEmitter } from "react-native";
import notifee, { EventType, type Event } from "@notifee/react-native";
import messaging, { type FirebaseMessagingTypes } from "@react-native-firebase/messaging";
import {
  displayIncomingCall,
  handleIncomingCallEvent,
  setupIncomingCallCategory,
  cancelIncomingCall,
  type IncomingCallData,
} from "../services/incomingCallNotification";
import {
  INCOMING_CALL_EVENT,
  clearPendingCallAction,
  readPendingCallAction,
  sendRingingAck,
  type PendingCallAction,
} from "../services/incomingCallActions";
import type { CallState } from "./useWebRTCCall";

type IncomingBridgeArgs = {
  isAuthenticated: boolean;
  callState: CallState;
  acceptCall: () => Promise<void> | void;
  rejectCall: () => void;
  armAutoAccept: (callId: string | null) => void;
};

function parseRemotePayload(
  data: FirebaseMessagingTypes.RemoteMessage["data"] | undefined,
): IncomingCallData | null {
  if (!data || data.type !== "incoming_call") return null;
  const callId = typeof data.callId === "string" ? data.callId : "";
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId : "";
  const fromDisplayName = typeof data.fromDisplayName === "string" ? data.fromDisplayName : "";
  if (!callId || !fromUserId) return null;
  return { callId, fromUserId, fromDisplayName: fromDisplayName || fromUserId };
}

/**
 * Wires foreground FCM data messages and Notifee action presses into the
 * existing WebRTC call hook.
 *
 * Foreground (`AppState === "active"`): we suppress the Notifee
 * heads-up because the in-app `CallOverlay` is already showing — a
 * banner on top would be redundant.
 *
 * Backgrounded but JS still alive: `messaging().onMessage` fires here
 * (RN Firebase routes to onMessage as long as the JS context is alive)
 * so we render the heads-up so the user can answer without bringing the
 * app forward.
 *
 * Killed: `setBackgroundMessageHandler` (registered in `index.ts`)
 * displays the heads-up; this hook then resumes when the app cold-starts
 * via `Answer` and pre-arms `armAutoAccept` so the call goes straight to
 * "Connecting..." instead of flashing through the in-app ringing UI.
 */
export function useIncomingCallBridge({
  isAuthenticated,
  callState,
  acceptCall,
  rejectCall,
  armAutoAccept,
}: IncomingBridgeArgs): void {
  // Tracked as state (not a ref) so that when AsyncStorage finishes
  // reading after the call has already reached "ringing" via the
  // WebSocket, the auto-accept effect re-runs.
  const [pendingAcceptCallId, setPendingAcceptCallId] = useState<string | null>(null);
  const acceptRef = useRef(acceptCall);
  const rejectRef = useRef(rejectCall);
  const armRef = useRef(armAutoAccept);
  acceptRef.current = acceptCall;
  rejectRef.current = rejectCall;
  armRef.current = armAutoAccept;

  // One-off iOS category setup. Idempotent on Android.
  useEffect(() => {
    void setupIncomingCallCategory();
  }, []);

  // FCM messages while the JS context is alive. Two payload types:
  //   - "incoming_call": render Notifee only when backgrounded; in
  //     foreground/active the in-app CallOverlay already shows.
  //   - "cancel_call": dismiss any active heads-up + clear pending
  //     actions (caller hung up while our phone was still ringing).
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const unsub = messaging().onMessage(async (remote) => {
      const data = remote?.data;
      const type = data && typeof data.type === "string" ? data.type : "";

      if (type === "cancel_call") {
        const callId = typeof data?.callId === "string" ? data.callId : "";
        if (callId) {
          try {
            await cancelIncomingCall(callId);
          } catch {
            // ignore
          }
          try {
            await clearPendingCallAction();
          } catch {
            // ignore
          }
          // If the WS already pushed us to ringing, drop the auto-accept
          // bookkeeping so a stale Answer press can't sneak through.
          setPendingAcceptCallId(null);
          try {
            armRef.current(null);
          } catch {
            // ignore
          }
        }
        return;
      }

      const payload = parseRemotePayload(data);
      if (!payload) return;
      if (AppState.currentState === "active") {
        try {
          await cancelIncomingCall(payload.callId);
        } catch {
          // ignore
        }
        return;
      }
      try {
        await displayIncomingCall(payload);
      } catch (err) {
        console.warn("[fcm-fg] failed to display incoming call", err);
      }
      // Tell backend the heads-up is on screen so the caller's UI
      // flips out of "Reaching device..." into "Calling...".
      try {
        await sendRingingAck(payload.callId);
      } catch {
        // ignore
      }
    });
    return () => {
      try {
        unsub();
      } catch {
        // ignore
      }
    };
  }, [isAuthenticated]);

  // Foreground notifee events: when the app is alive (foreground or
  // background but not killed), action presses come through this listener.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const unsub = notifee.onForegroundEvent((event: Event) => {
      void handleIncomingCallEvent(event);
    });
    return unsub;
  }, [isAuthenticated]);

  // React to pending actions emitted by the notifee listeners (foreground
  // or background) and to anything persisted from a cold start.
  useEffect(() => {
    if (!isAuthenticated) return undefined;

    let cancelled = false;

    const handle = async (action: PendingCallAction) => {
      if (cancelled) return;
      if (action.kind === "accept") {
        // Pre-arm useWebRTCCall so the next call_offer for this id
        // skips the ringing UI entirely. Also keep the state-based
        // pending id as a fallback for the case where the WS already
        // delivered the offer (e.g. background-alive) and the call is
        // already in "ringing" by the time we read AsyncStorage.
        try {
          armRef.current(action.payload.callId);
        } catch {
          // ignore
        }
        setPendingAcceptCallId(action.payload.callId);
        await clearPendingCallAction();
      } else if (action.kind === "decline") {
        // The decline HTTP call is fired in incomingCallActions; here we
        // also trigger the in-app reject path in case the WS happens to
        // be connected, ensuring local state is reset.
        try {
          rejectRef.current();
        } catch {
          // ignore
        }
        await clearPendingCallAction();
      }
    };

    void (async () => {
      const initial = await readPendingCallAction();
      if (initial) {
        await handle(initial);
      }
    })();

    const sub = DeviceEventEmitter.addListener(INCOMING_CALL_EVENT, (action: PendingCallAction) => {
      void handle(action);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [isAuthenticated]);

  // Reconcile the pending Accept against the actual call state.
  //
  // - Fast path: `armAutoAccept` was set in time and useWebRTCCall sent
  //   the call directly to "connecting"; we just clear the bookkeeping.
  // - Fallback path: arming missed the offer (e.g. AsyncStorage finished
  //   AFTER call_offer arrived), so the call is now "ringing" → fire
  //   `acceptCall()` to advance it.
  //
  // Re-runs on either pending state OR call state change, so it works
  // regardless of which finished resolving first on cold start.
  useEffect(() => {
    if (!pendingAcceptCallId) return;
    if (callState.callId !== pendingAcceptCallId) return;

    if (callState.status === "ringing") {
      setPendingAcceptCallId(null);
      try {
        const result = acceptRef.current();
        if (result instanceof Promise) {
          result.catch(() => {
            // surfaced via existing alerts in useWebRTCCall
          });
        }
      } catch {
        // ignore
      }
      return;
    }

    if (callState.status !== "idle") {
      // Already connecting/connected via the armed fast path.
      setPendingAcceptCallId(null);
    }
  }, [callState.callId, callState.status, pendingAcceptCallId]);

  // Whenever the in-app call ends, dismiss any leftover notification.
  useEffect(() => {
    if (callState.status === "idle" && callState.callId) {
      void cancelIncomingCall(callState.callId);
    }
  }, [callState.callId, callState.status]);

  // Clear any pending call action ONLY on a real sign-out transition
  // (was authenticated → no longer authenticated).
  //
  // On cold start the app boots with `isAuthenticated === false` until
  // Firebase restores the persisted user; running cleanup at that point
  // would wipe the pending Accept the headless JS handler just wrote
  // when the user tapped "Answer", and the auto-accept flow would
  // silently break — exactly the cold-start re-tap symptom we hit.
  const hasEverAuthenticatedRef = useRef(false);
  useEffect(() => {
    if (isAuthenticated) {
      hasEverAuthenticatedRef.current = true;
      return;
    }
    if (!hasEverAuthenticatedRef.current) return;
    setPendingAcceptCallId(null);
    try {
      armRef.current(null);
    } catch {
      // ignore
    }
    void clearPendingCallAction();
  }, [isAuthenticated]);
}
