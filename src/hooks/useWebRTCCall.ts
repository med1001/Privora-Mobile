import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, PermissionsAndroid, Platform } from "react-native";
import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
} from "react-native-webrtc";
import { fetchRtcConfig } from "../services/api";
import { callAudio } from "../services/callAudio";

async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const already = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (already) return true;
    const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: "Microphone",
      message: "Privora needs access to your microphone for voice calls.",
      buttonPositive: "Allow",
      buttonNegative: "Deny",
    });
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export type CallState = {
  status: "idle" | "calling" | "calling_offline" | "ringing" | "connecting" | "connected" | "reconnecting";
  peerId: string | null;
  peerName: string | null;
  isIncoming: boolean;
  callId: string | null;
};

type RTCConfigPayload = {
  iceServers?: Array<{ urls?: string | string[]; username?: string; credential?: string; url?: string }>;
  iceTransportPolicy?: "all" | "relay";
};

type IceCandidateInit = { candidate?: string; sdpMLineIndex?: number | null; sdpMid?: string | null };
type SessionDescriptionInit = { sdp: string; type: "offer" | "answer" };

// react-native-webrtc's MediaTrackConstraints type omits common audio
// processing flags, so we cast through unknown to opt-in to them at runtime.
const AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
} as unknown as { audio: boolean; video: boolean };

const DEFAULT_ICE_SERVERS: RTCConfigPayload["iceServers"] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

function randomCallId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function toSessionDescriptionInit(description: unknown, fallbackType: "offer" | "answer"): SessionDescriptionInit {
  const maybeJson = description as { toJSON?: () => { sdp?: string; type?: string } };
  const json = typeof maybeJson?.toJSON === "function" ? maybeJson.toJSON() : undefined;
  const raw = (json ?? description) as { sdp?: string; type?: string };
  const sdp = raw?.sdp ?? "";
  if (!sdp) {
    throw new Error(`Invalid ${fallbackType} SDP`);
  }
  return { sdp, type: raw?.type === "answer" || raw?.type === "offer" ? raw.type : fallbackType };
}

/** react-native-webrtc RTCPeerConnection extends EventTarget; TS defs omit addEventListener. */
function peerAddListener(pc: RTCPeerConnection, type: string, listener: (event: any) => void) {
  (pc as unknown as { addEventListener: (t: string, l: (e: any) => void) => void }).addEventListener(type, listener);
}

export function useWebRTCCall(args: {
  localUserId: string;
  localDisplayName: string;
  getIdToken: () => Promise<string>;
  sendRaw: (data: Record<string, unknown>) => boolean;
  onCallEnded: (peerId: string, durationStr: string, missed: boolean, wasOutgoingCaller: boolean) => void;
}) {
  const { localUserId, localDisplayName, getIdToken, sendRaw, onCallEnded } = args;

  const [callState, setCallState] = useState<CallState>({
    status: "idle",
    peerId: null,
    peerName: null,
    isIncoming: false,
    callId: null,
  });
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioSessionActiveRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const currentCallIdRef = useRef<string | null>(null);
  const callStateRef = useRef<CallState>(callState);
  const rtcConfigRef = useRef<RTCConfigPayload>({ iceServers: DEFAULT_ICE_SERVERS, iceTransportPolicy: "all" });
  const iceCandidateQueueRef = useRef<Array<{ callId: string; candidate: IceCandidateInit }>>([]);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionLossTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasEmittedCallConnectedRef = useRef(false);
  const onCallEndedRef = useRef(onCallEnded);
  onCallEndedRef.current = onCallEnded;

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!localUserId) {
        rtcConfigRef.current = { iceServers: DEFAULT_ICE_SERVERS, iceTransportPolicy: "all" };
        return;
      }
      try {
        const token = await getIdToken();
        const data = await fetchRtcConfig(token);
        if (!mounted) return;
        rtcConfigRef.current = {
          iceServers: data.iceServers && data.iceServers.length > 0 ? data.iceServers : DEFAULT_ICE_SERVERS,
          iceTransportPolicy: data.iceTransportPolicy || "all",
        };
      } catch {
        if (mounted) {
          rtcConfigRef.current = { iceServers: DEFAULT_ICE_SERVERS, iceTransportPolicy: "all" };
        }
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [getIdToken, localUserId]);

  const clearCallTimers = useCallback(() => {
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }
    if (callingTimeoutRef.current) {
      clearTimeout(callingTimeoutRef.current);
      callingTimeoutRef.current = null;
    }
    if (connectionLossTimeoutRef.current) {
      clearTimeout(connectionLossTimeoutRef.current);
      connectionLossTimeoutRef.current = null;
    }
  }, []);

  const resetPeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  }, []);

  const flushQueuedIceCandidates = useCallback(async (callId: string, pc: RTCPeerConnection) => {
    const queued = iceCandidateQueueRef.current.filter((item) => item.callId === callId);
    iceCandidateQueueRef.current = iceCandidateQueueRef.current.filter((item) => item.callId !== callId);
    for (const item of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(item.candidate));
      } catch {
        // ignore
      }
    }
  }, []);

  const beginCallAudioSession = useCallback(() => {
    if (audioSessionActiveRef.current) return;
    audioSessionActiveRef.current = true;
    callAudio.startSession();
    setIsSpeaker(false);
  }, []);

  const endCallAudioSession = useCallback(() => {
    if (!audioSessionActiveRef.current) return;
    audioSessionActiveRef.current = false;
    callAudio.stopSession();
    setIsSpeaker(false);
  }, []);

  const toggleSpeaker = useCallback(() => {
    setIsSpeaker((prev) => {
      const next = !prev;
      callAudio.setSpeakerphone(next);
      return next;
    });
  }, []);

  const cleanupCall = useCallback(
    (recordEnd: boolean = true) => {
      clearCallTimers();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }

      resetPeerConnection();
      endCallAudioSession();
      setIsMuted(false);

      const previousState = callStateRef.current;
      const activeCallId = currentCallIdRef.current;
      currentCallIdRef.current = null;
      hasEmittedCallConnectedRef.current = false;
      iceCandidateQueueRef.current = iceCandidateQueueRef.current.filter((item) => item.callId !== activeCallId);

      const endTime = Date.now();
      const startTime = callStartTimeRef.current;
      callStartTimeRef.current = null;

      if (recordEnd && previousState.peerId) {
        let durationStr = "00:00";
        let missed = false;
        if (startTime) {
          const diffSeconds = Math.floor((endTime - startTime) / 1000);
          const m = Math.floor(diffSeconds / 60)
            .toString()
            .padStart(2, "0");
          const s = (diffSeconds % 60).toString().padStart(2, "0");
          durationStr = `${m}:${s}`;
        } else {
          missed = previousState.status !== "connected" && previousState.status !== "reconnecting";
        }
        onCallEndedRef.current(previousState.peerId, durationStr, missed, !previousState.isIncoming);
      }

      const idleState: CallState = {
        status: "idle",
        peerId: null,
        peerName: null,
        isIncoming: false,
        callId: null,
      };
      callStateRef.current = idleState;
      setCallState(idleState);
    },
    [clearCallTimers, endCallAudioSession, resetPeerConnection],
  );

  const createPeerConnection = useCallback(
    (peerId: string, callId: string) => {
      hasEmittedCallConnectedRef.current = false;

      const pc = new RTCPeerConnection({
        iceServers: rtcConfigRef.current.iceServers || DEFAULT_ICE_SERVERS,
        iceTransportPolicy: rtcConfigRef.current.iceTransportPolicy || "all",
      });

      const emitCallConnectedOnce = () => {
        if (currentCallIdRef.current !== callId || hasEmittedCallConnectedRef.current) return;
        hasEmittedCallConnectedRef.current = true;
        if (!callStartTimeRef.current) {
          callStartTimeRef.current = Date.now();
        }
        if (connectionLossTimeoutRef.current) {
          clearTimeout(connectionLossTimeoutRef.current);
          connectionLossTimeoutRef.current = null;
        }
        setCallState((prev) => (prev.callId === callId ? { ...prev, status: "connected" } : prev));
        sendRaw({ type: "call_connected", to: peerId, callId });
      };

      peerAddListener(pc, "icecandidate", (event: { candidate?: { toJSON?: () => IceCandidateInit } | IceCandidateInit | null }) => {
        const raw = event.candidate;
        if (!raw || currentCallIdRef.current !== callId) return;
        const candidate =
          typeof (raw as { toJSON?: () => IceCandidateInit }).toJSON === "function"
            ? (raw as { toJSON: () => IceCandidateInit }).toJSON()
            : (raw as IceCandidateInit);
        sendRaw({ type: "ice_candidate", to: peerId, callId, candidate });
      });

      peerAddListener(pc, "track", () => {
        if (currentCallIdRef.current !== callId) return;
        // Remote audio plays via native WebRTC audio session on device.
      });

      peerAddListener(pc, "iceconnectionstatechange", () => {
        if (currentCallIdRef.current !== callId) return;
        const iceState = pc.iceConnectionState;
        if (iceState === "connected" || iceState === "completed") {
          emitCallConnectedOnce();
        }
        if (iceState === "failed") {
          sendRaw({ type: "call_end", to: peerId, callId, reason: "ice_failed" });
          cleanupCall(true);
        }
      });

      peerAddListener(pc, "connectionstatechange", () => {
        if (currentCallIdRef.current !== callId) return;
        const state = pc.connectionState;
        if (state === "connected") {
          emitCallConnectedOnce();
          return;
        }
        if (state === "disconnected") {
          setCallState((prev) =>
            prev.callId === callId && prev.status !== "idle" ? { ...prev, status: "reconnecting" } : prev,
          );
          if (!connectionLossTimeoutRef.current) {
            connectionLossTimeoutRef.current = setTimeout(() => {
              if (currentCallIdRef.current !== callId) return;
              sendRaw({ type: "call_end", to: peerId, callId, reason: "connection_lost" });
              cleanupCall(true);
            }, 10000);
          }
          return;
        }
        if (state === "failed" || state === "closed") {
          sendRaw({
            type: "call_end",
            to: peerId,
            callId,
            reason: state === "failed" ? "connection_failed" : "connection_closed",
          });
          cleanupCall(true);
        }
      });

      pcRef.current = pc;
      return pc;
    },
    [cleanupCall, sendRaw],
  );

  const initiateCall = useCallback(
    async (peerId: string, peerName: string) => {
      if (!localUserId || callStateRef.current.status !== "idle") return;

      const callId = randomCallId();
      currentCallIdRef.current = callId;
      setCallState({ status: "calling", peerId, peerName, isIncoming: false, callId });

      try {
        clearCallTimers();
        resetPeerConnection();

        const granted = await ensureMicPermission();
        if (!granted) {
          cleanupCall(false);
          Alert.alert("Microphone", "Microphone permission is required to start a call.");
          return;
        }

        beginCallAudioSession();
        const stream = await mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
        localStreamRef.current = stream;
        const pc = createPeerConnection(peerId, callId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer({});
        const offerOut = toSessionDescriptionInit(offer, "offer");
        await pc.setLocalDescription(offerOut);

        const selfDisplayNameStr = localDisplayName || localUserId || "User";

        callingTimeoutRef.current = setTimeout(() => {
          if (currentCallIdRef.current !== callId) return;
          sendRaw({ type: "call_end", to: peerId, callId, reason: "timeout" });
          cleanupCall(false);
        }, 45000);

        sendRaw({
          type: "call_offer",
          to: peerId,
          callId,
          offer: offerOut,
          fromDisplayName: selfDisplayNameStr,
        });
      } catch {
        cleanupCall(false);
        Alert.alert("Microphone", "Could not access microphone.");
      }
    },
    [
      beginCallAudioSession,
      clearCallTimers,
      cleanupCall,
      createPeerConnection,
      localDisplayName,
      localUserId,
      resetPeerConnection,
      sendRaw,
    ],
  );

  const acceptCall = useCallback(async () => {
    if (callState.status !== "ringing" || !callState.peerId || !callState.callId) return;
    const peerId = callState.peerId;
    const callId = callState.callId;
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }
    setCallState((prev) => (prev.callId === callId ? { ...prev, status: "connecting" } : prev));

    try {
      const granted = await ensureMicPermission();
      if (!granted) {
        sendRaw({ type: "call_reject", to: peerId, callId, reason: "permission_denied" });
        cleanupCall(false);
        Alert.alert("Microphone", "Microphone permission is required to answer a call.");
        return;
      }
      beginCallAudioSession();
      const stream = await mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
      localStreamRef.current = stream;
      const pc = pcRef.current;
      if (!pc) throw new Error("Peer connection not ready");
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const answer = await pc.createAnswer();
      const answerOut = toSessionDescriptionInit(answer, "answer");
      await pc.setLocalDescription(answerOut);
      await flushQueuedIceCandidates(callId, pc);

      sendRaw({ type: "call_accepting", to: peerId, callId });
      sendRaw({ type: "call_answer", to: peerId, callId, answer: answerOut });
    } catch {
      cleanupCall(false);
      Alert.alert("Microphone", "Could not access microphone.");
    }
  }, [
    beginCallAudioSession,
    callState.callId,
    callState.peerId,
    callState.status,
    cleanupCall,
    flushQueuedIceCandidates,
    sendRaw,
  ]);

  const rejectCall = useCallback(() => {
    if (callState.peerId && callState.callId) {
      sendRaw({ type: "call_reject", to: callState.peerId, callId: callState.callId, reason: "declined" });
    }
    cleanupCall(true);
  }, [callState.callId, callState.peerId, cleanupCall, sendRaw]);

  const endCall = useCallback(() => {
    if (callState.peerId && callState.callId) {
      sendRaw({ type: "call_end", to: callState.peerId, callId: callState.callId });
    }
    cleanupCall(true);
  }, [callState.callId, callState.peerId, cleanupCall, sendRaw]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks[0].enabled = !audioTracks[0].enabled;
        setIsMuted(!audioTracks[0].enabled);
      }
    }
  }, []);

  const handleWebRTCSignal = useCallback(
    async (parsed: Record<string, unknown>) => {
      const type = parsed.type as string;
      const from = parsed.from as string | undefined;
      const callId = parsed.callId as string | undefined;

      if (!callId) return;

      if (type === "call_offer") {
        if (!from) return;
        if (callStateRef.current.status !== "idle") {
          sendRaw({ type: "call_reject", to: from, callId, reason: "busy" });
          return;
        }

        currentCallIdRef.current = callId;
        if (ringingTimeoutRef.current) clearTimeout(ringingTimeoutRef.current);
        ringingTimeoutRef.current = setTimeout(() => {
          if (currentCallIdRef.current !== callId) return;
          sendRaw({ type: "call_reject", to: from, callId, reason: "timeout" });
          cleanupCall(false);
        }, 45000);

        setCallState({
          status: "ringing",
          peerId: from,
          peerName: (parsed.fromDisplayName as string) || from,
          isIncoming: true,
          callId,
        });

        setTimeout(async () => {
          if (currentCallIdRef.current !== callId) return;
          try {
            resetPeerConnection();
            const pc = createPeerConnection(from, callId);
            const offer = parsed.offer as { type?: string; sdp?: string };
            if (!offer?.sdp || !offer?.type) throw new Error("Invalid SDP offer");
            await pc.setRemoteDescription(new RTCSessionDescription({ sdp: offer.sdp, type: offer.type }));
            await flushQueuedIceCandidates(callId, pc);
            sendRaw({ type: "call_ring", to: from, callId });
          } catch {
            sendRaw({ type: "call_reject", to: from, callId, reason: "setup_failed" });
            cleanupCall(false);
          }
        }, 0);
      } else if (type === "call_ring") {
        if (currentCallIdRef.current !== callId) return;
        setCallState((state) =>
          state.callId === callId && (state.status === "calling" || state.status === "calling_offline")
            ? { ...state, status: "calling" }
            : state,
        );
      } else if (type === "call_ring_offline") {
        if (currentCallIdRef.current !== callId) return;
        setCallState((state) =>
          state.callId === callId && state.status === "calling" ? { ...state, status: "calling_offline" } : state,
        );
      } else if (type === "call_accepting") {
        if (currentCallIdRef.current !== callId) return;
        if (callingTimeoutRef.current) {
          clearTimeout(callingTimeoutRef.current);
          callingTimeoutRef.current = null;
        }
        setCallState((state) =>
          state.callId === callId && (state.status === "calling" || state.status === "calling_offline")
            ? { ...state, status: "connecting" }
            : state,
        );
      } else if (type === "call_answer") {
        if (currentCallIdRef.current !== callId) return;
        if (callingTimeoutRef.current) {
          clearTimeout(callingTimeoutRef.current);
          callingTimeoutRef.current = null;
        }
        if (pcRef.current) {
          try {
            const wrapped = parsed as { answer?: { sdp?: string; type?: string }; sdp?: string; type?: string };
            let sdp: string | undefined;
            let typ: string | undefined;
            if (wrapped.answer?.sdp) {
              sdp = wrapped.answer.sdp;
              typ = wrapped.answer.type || "answer";
            } else if (wrapped.sdp) {
              sdp = wrapped.sdp;
              typ = wrapped.type || "answer";
            }
            if (!sdp || !typ) throw new Error("Invalid SDP answer");
            await pcRef.current.setRemoteDescription(new RTCSessionDescription({ sdp, type: typ }));
            setCallState((state) => (state.callId === callId ? { ...state, status: "connecting" } : state));
            await flushQueuedIceCandidates(callId, pcRef.current);
          } catch {
            if (from) sendRaw({ type: "call_end", to: from, callId, reason: "answer_setup_failed" });
            cleanupCall(false);
          }
        }
      } else if (type === "call_connected") {
        if (currentCallIdRef.current !== callId) return;
        if (!callStartTimeRef.current) {
          callStartTimeRef.current = Date.now();
        }
        setCallState((state) => (state.callId === callId ? { ...state, status: "connected" } : state));
      } else if (type === "ice_candidate") {
        if (currentCallIdRef.current !== callId) return;
        const raw = parsed.candidate as IceCandidateInit | undefined;
        if (!raw) return;
        if (pcRef.current && pcRef.current.remoteDescription) {
          pcRef.current.addIceCandidate(new RTCIceCandidate(raw)).catch(() => {});
        } else {
          iceCandidateQueueRef.current.push({ callId, candidate: raw });
        }
      } else if (type === "call_reject") {
        if (currentCallIdRef.current !== callId) return;
        cleanupCall(true);
      } else if (type === "call_end") {
        if (currentCallIdRef.current !== callId) return;
        cleanupCall(true);
      }
    },
    [cleanupCall, createPeerConnection, flushQueuedIceCandidates, resetPeerConnection, sendRaw],
  );

  useEffect(() => {
    if (!localUserId) {
      cleanupCall(false);
    }
  }, [cleanupCall, localUserId]);

  return {
    callState,
    isMuted,
    isSpeaker,
    toggleMute,
    toggleSpeaker,
    initiateCall,
    acceptCall,
    rejectCall,
    endCall,
    handleWebRTCSignal,
  };
}
