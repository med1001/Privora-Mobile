import { isCurrentPushRecipient } from "../services/pushIdentity";
import { useEffect, useRef, useState } from "react";
import { AppState, DeviceEventEmitter } from "react-native";
import notifee, { type Event } from "@notifee/react-native";
import messaging from "@react-native-firebase/messaging";
import {
  handleIncomingCallEvent,
  setupIncomingCallCategory,
  cancelIncomingCall,
} from "../services/incomingCallNotification";
import {
  INCOMING_CALL_EVENT,
  clearPendingCallAction,
  readPendingCallAction,
  type PendingCallAction,
} from "../services/incomingCallActions";
import { handleIncomingCallMessage } from "../services/incomingCallMessages";
import type { CallState } from "./useWebRTCCall";

type IncomingBridgeArgs = {
  userId: string | null;
  callState: CallState;
  acceptCall: () => Promise<void> | void;
  rejectCall: () => void;
  armAutoAccept: (callId: string | null) => void;
};

/**
 * Wires foreground FCM data messages and Notifee action presses into the
 * existing WebRTC call hook.
 *
 * Foreground (`AppState === "active"`): we suppress the Notifee
 * heads-up because the in-app `CallOverlay` is already showing â€” a
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
  userId,
  callState,
  acceptCall,
  rejectCall,
  armAutoAccept,
}: IncomingBridgeArgs): void {
  const isAuthenticated = !!userId;
  // Tracked as state (not a ref) so that when AsyncStorage finishes
  // reading after the call has already reached "ringing" via the
  // WebSocket, the auto-accept effect re-runs.
  const [pendingAcceptCallId, setPendingAcceptCallId] = useState<string | null>(null);
  const pendingRecipientRef = useRef<string | null>(null);
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
    let cancelled = false;
    const unsub = messaging().onMessage(async (remote) => {
      const outcome = await handleIncomingCallMessage(remote.data, AppState.currentState !== "active");
      if (!cancelled && outcome?.cancelledCallId) {
        setPendingAcceptCallId(current => current === outcome.cancelledCallId ? null : current);
        armRef.current(null);
      }
    });
    return () => {
      cancelled = true;
      try {
        unsub();
      } catch {
        // ignore
      }
    };
  }, [isAuthenticated, userId]);

  // Foreground notifee events: when the app is alive (foreground or
  // background but not killed), action presses come through this listener.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const unsub = notifee.onForegroundEvent((event: Event) => {
      void handleIncomingCallEvent(event);
    });
    return unsub;
  }, [isAuthenticated, userId]);

  // React to pending actions emitted by the notifee listeners (foreground
  // or background) and to anything persisted from a cold start.
  useEffect(() => {
    if (!isAuthenticated) return undefined;

    let cancelled = false;

    const handle = async (action: PendingCallAction) => {
      if (!(await isCurrentPushRecipient(action.payload.toUserId)) || cancelled) return;
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
        pendingRecipientRef.current = userId;
        setPendingAcceptCallId(action.payload.callId);
        await clearPendingCallAction(action.payload.callId);
      } else if (action.kind === "decline") {
        // The decline HTTP call is fired in incomingCallActions; here we
        // also trigger the in-app reject path in case the WS happens to
        // be connected, ensuring local state is reset.
        try {
          rejectRef.current();
        } catch {
          // ignore
        }
        await clearPendingCallAction(action.payload.callId);
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
  }, [isAuthenticated, userId]);

  // Reconcile the pending Accept against the actual call state.
  //
  // - Fast path: `armAutoAccept` was set in time and useWebRTCCall sent
  //   the call directly to "connecting"; we just clear the bookkeeping.
  // - Fallback path: arming missed the offer (e.g. AsyncStorage finished
  //   AFTER call_offer arrived), so the call is now "ringing" â†’ fire
  //   `acceptCall()` to advance it.
  //
  // Re-runs on either pending state OR call state change, so it works
  // regardless of which finished resolving first on cold start.
  useEffect(() => {
    if (!isAuthenticated || pendingRecipientRef.current !== userId || !pendingAcceptCallId) return;
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
  }, [callState.callId, callState.status, pendingAcceptCallId, isAuthenticated, userId]);

  // Whenever the in-app call ends, dismiss any leftover notification.
  useEffect(() => {
    if (callState.status === "idle" && callState.callId) {
      void cancelIncomingCall(callState.callId);
    }
  }, [callState.callId, callState.status]);

  // Reset in-memory intent on every account transition, including A -> B.
  // Persisted cold-start intent is validated by readPendingCallAction above.
  useEffect(() => {
    pendingRecipientRef.current = null;
    setPendingAcceptCallId(null);
    armRef.current(null);
  }, [userId]);
}
