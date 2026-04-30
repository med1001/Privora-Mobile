import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";

type Props = {
  disabled: boolean;
  onRecorded: (dataUrl: string) => void;
};

const MIN_DURATION_MS = 600;

function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${rest.toString().padStart(2, "0")}`;
}

function inferExtension(uri: string, fallback: string) {
  const match = uri.match(/\.([a-zA-Z0-9]+)(?:$|\?)/);
  return match ? match[1].toLowerCase() : fallback;
}

function inferMime(extension: string) {
  switch (extension) {
    case "m4a":
    case "mp4":
    case "aac":
      return "audio/mp4";
    case "3gp":
    case "3gpp":
      return "audio/3gpp";
    case "amr":
      return "audio/amr";
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm";
    case "mp3":
      return "audio/mpeg";
    case "ogg":
      return "audio/ogg";
    default:
      return "audio/mp4";
  }
}

export function VoiceRecorder({ disabled, onRecorded }: Props) {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Recording instance and timer are kept in refs so updating them does not
  // re-run the unmount-only cleanup effect below (which would clear the
  // interval the moment we just started it - cause of the stuck 00:00 bug).
  const recordingRef = useRef<Audio.Recording | null>(null);
  const startedAtRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      const ongoing = recordingRef.current;
      recordingRef.current = null;
      if (ongoing) {
        ongoing.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  const tearDownTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const startRecording = async () => {
    if (busy || disabled || recordingRef.current) return;
    setBusy(true);
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Microphone required", "Privora needs microphone access to record voice messages.");
        return;
      }
      // Recording must be allowed in the audio session BEFORE creating the
      // Recording instance, otherwise iOS silently produces an empty file.
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );

      recordingRef.current = recording;
      startedAtRef.current = Date.now();
      setElapsed(0);
      setActive(true);

      tearDownTimer();
      intervalRef.current = setInterval(() => {
        if (!isMountedRef.current) return;
        setElapsed(Date.now() - startedAtRef.current);
      }, 200);
    } catch (err) {
      recordingRef.current = null;
      tearDownTimer();
      setActive(false);
      Alert.alert("Recording failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const stopRecording = async (cancel: boolean) => {
    const ongoing = recordingRef.current;
    if (!ongoing) return;
    setBusy(true);
    tearDownTimer();
    try {
      const durationMs = Date.now() - startedAtRef.current;
      await ongoing.stopAndUnloadAsync();
      const uri = ongoing.getURI();
      recordingRef.current = null;

      // Reset audio mode so playback (call ringtone, message sound, etc.)
      // works again on iOS after a recording session.
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });
      } catch {
        // best-effort
      }

      if (cancel || !uri) return;
      if (durationMs < MIN_DURATION_MS) {
        Alert.alert("Too short", "Hold a bit longer to record a voice message.");
        return;
      }

      const ext = inferExtension(uri, "m4a");
      const mime = inferMime(ext);
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (!base64) {
        Alert.alert("Recording failed", "The voice message is empty. Please try again.");
        return;
      }
      onRecorded(`data:${mime};base64,${base64}`);
    } catch (err) {
      Alert.alert("Recording failed", err instanceof Error ? err.message : String(err));
    } finally {
      if (isMountedRef.current) {
        setActive(false);
        setBusy(false);
        setElapsed(0);
      }
    }
  };

  if (active) {
    return (
      <View style={styles.activeRow}>
        <View style={styles.dotPulse} />
        <Text style={styles.timer}>{formatElapsed(elapsed)}</Text>
        <Pressable
          onPress={() => void stopRecording(true)}
          style={[styles.actionBtn, styles.cancelBtn]}
          accessibilityLabel="Cancel recording"
        >
          <Ionicons name="close" size={16} color="#ffffff" />
        </Pressable>
        <Pressable
          onPress={() => void stopRecording(false)}
          style={[styles.actionBtn, styles.confirmBtn]}
          accessibilityLabel="Send voice message"
        >
          <Ionicons name="checkmark" size={16} color="#ffffff" />
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      onPress={startRecording}
      style={[styles.btn, (disabled || busy) && styles.btnDisabled]}
      accessibilityLabel="Start voice message"
      disabled={disabled || busy}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#2563eb" />
      ) : (
        <Ionicons name="mic-outline" size={20} color={disabled ? "#cbd5e1" : "#6b7280"} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: {
    opacity: 0.5,
  },
  activeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  dotPulse: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: "#ef4444",
  },
  timer: {
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    minWidth: 38,
  },
  actionBtn: {
    width: 26,
    height: 26,
    borderRadius: 99,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtn: {
    backgroundColor: "#94a3b8",
  },
  confirmBtn: {
    backgroundColor: "#22c55e",
  },
});
