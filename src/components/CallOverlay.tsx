import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import type { CallState } from "../hooks/useWebRTCCall";

type Props = {
  callState: CallState;
  isMuted: boolean;
  isSpeaker: boolean;
  onAccept: () => void;
  onReject: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
};

const CALLING_SOUND = require("../../assets/sounds/calling.mp3");
const RINGING_SOUND = require("../../assets/sounds/ringing.mp3");
const OFFLINE_SOUND = require("../../assets/sounds/offline_calling.wav");

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function statusLabel(status: CallState["status"], duration: number) {
  switch (status) {
    case "calling":
      return "Calling…";
    case "calling_offline":
      return "User is offline. Waiting for them to reconnect…";
    case "ringing":
      return "Incoming Call…";
    case "connecting":
      return "Connecting audio…";
    case "connected":
      return formatDuration(duration);
    case "reconnecting":
      return "Reconnecting…";
    default:
      return "";
  }
}

export function CallOverlay({
  callState,
  isMuted,
  isSpeaker,
  onAccept,
  onReject,
  onHangup,
  onToggleMute,
  onToggleSpeaker,
}: Props) {
  const visible = callState.status !== "idle";
  const soundRef = useRef<Audio.Sound | null>(null);
  const currentTrackRef = useRef<"calling" | "ringing" | "offline" | null>(null);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    // The microphone is captured during the call, so iOS recording must
    // remain allowed; otherwise the WebRTC capture session conflicts with
    // expo-av's playback session and audio breaks.
    Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      playThroughEarpieceAndroid: false,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (callState.status !== "connected") {
      setDuration(0);
      return undefined;
    }
    const timer = setInterval(() => setDuration((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [callState.status]);

  useEffect(() => {
    let cancelled = false;

    const stopCurrent = async () => {
      const existing = soundRef.current;
      soundRef.current = null;
      currentTrackRef.current = null;
      if (existing) {
        try {
          await existing.stopAsync();
        } catch {}
        try {
          await existing.unloadAsync();
        } catch {}
      }
    };

    const playTrack = async (track: "calling" | "ringing" | "offline") => {
      if (currentTrackRef.current === track && soundRef.current) return;
      await stopCurrent();
      if (cancelled) return;
      const source = track === "calling" ? CALLING_SOUND : track === "ringing" ? RINGING_SOUND : OFFLINE_SOUND;
      try {
        const { sound } = await Audio.Sound.createAsync(source, {
          isLooping: true,
          volume: 1.0,
          shouldPlay: true,
        });
        if (cancelled) {
          try {
            await sound.stopAsync();
          } catch {}
          try {
            await sound.unloadAsync();
          } catch {}
          return;
        }
        soundRef.current = sound;
        currentTrackRef.current = track;
      } catch {
        // Audio playback errors are non-fatal for the call itself.
      }
    };

    if (!visible) {
      void stopCurrent();
      return () => {
        cancelled = true;
      };
    }

    if (callState.status === "calling") {
      void playTrack("calling");
    } else if (callState.status === "ringing") {
      void playTrack("ringing");
    } else if (callState.status === "calling_offline") {
      void playTrack("offline");
    } else {
      void stopCurrent();
    }

    return () => {
      cancelled = true;
    };
  }, [callState.status, visible]);

  useEffect(() => {
    return () => {
      const existing = soundRef.current;
      soundRef.current = null;
      currentTrackRef.current = null;
      if (existing) {
        existing.stopAsync().catch(() => {});
        existing.unloadAsync().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (callState.status === "ringing") {
      const id = setInterval(() => Vibration.vibrate(400), 1400);
      return () => {
        clearInterval(id);
        Vibration.cancel();
      };
    }
    return undefined;
  }, [callState.status]);

  if (!visible) return null;

  const incomingRinging = callState.status === "ringing";

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={48} color="#3b82f6" />
          </View>

          <Text style={styles.name} numberOfLines={1}>
            {callState.peerName || callState.peerId || "Unknown User"}
          </Text>
          <Text style={styles.status}>{statusLabel(callState.status, duration)}</Text>

          <View style={styles.row}>
            {incomingRinging ? (
              <>
                <Pressable
                  style={[styles.roundBtn, styles.green]}
                  onPress={onAccept}
                  accessibilityLabel="Accept call"
                >
                  <Ionicons name="call" size={28} color="#fff" />
                </Pressable>
                <Pressable
                  style={[styles.roundBtn, styles.red]}
                  onPress={onReject}
                  accessibilityLabel="Reject call"
                >
                  <Ionicons name="call" size={28} color="#fff" style={styles.iconRotated} />
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  style={[styles.roundBtn, isMuted ? styles.muteOff : styles.muteOn]}
                  onPress={onToggleMute}
                  accessibilityLabel={isMuted ? "Unmute" : "Mute"}
                >
                  <Ionicons
                    name={isMuted ? "mic-off" : "mic"}
                    size={26}
                    color={isMuted ? "#6b7280" : "#ffffff"}
                  />
                </Pressable>
                <Pressable
                  style={[styles.roundBtn, isSpeaker ? styles.speakerOn : styles.speakerOff]}
                  onPress={onToggleSpeaker}
                  accessibilityLabel={isSpeaker ? "Switch to earpiece" : "Switch to speaker"}
                  accessibilityState={{ selected: isSpeaker }}
                >
                  <Ionicons
                    name={isSpeaker ? "volume-high" : "ear"}
                    size={26}
                    color={isSpeaker ? "#ffffff" : "#2563eb"}
                  />
                </Pressable>
                <Pressable
                  style={[styles.roundBtn, styles.hangup]}
                  onPress={onHangup}
                  accessibilityLabel="End call"
                >
                  <Ionicons name="call" size={32} color="#fff" style={styles.iconRotated} />
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#ffffff",
    borderRadius: 20,
    paddingHorizontal: 28,
    paddingVertical: 32,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 12,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 99,
    backgroundColor: "#dbeafe",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  name: {
    color: "#0f172a",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 4,
  },
  status: {
    color: "#6b7280",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  roundBtn: {
    width: 60,
    height: 60,
    borderRadius: 99,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  green: {
    backgroundColor: "#22c55e",
  },
  red: {
    backgroundColor: "#ef4444",
  },
  muteOn: {
    backgroundColor: "#1f2937",
  },
  muteOff: {
    backgroundColor: "#f3f4f6",
  },
  speakerOff: {
    backgroundColor: "#dbeafe",
  },
  speakerOn: {
    backgroundColor: "#2563eb",
  },
  hangup: {
    width: 76,
    height: 76,
    borderRadius: 99,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#ef4444",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  iconRotated: {
    transform: [{ rotate: "135deg" }],
  },
});
