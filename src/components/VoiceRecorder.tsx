import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";

type Props = {
  disabled: boolean;
  onRecorded: (dataUrl: string) => void;
};

function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${rest.toString().padStart(2, "0")}`;
}

export function VoiceRecorder({ disabled, onRecorded }: Props) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      const active = recording;
      if (active) {
        active.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, [recording]);

  const startRecording = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Microphone required", "Privora needs microphone access to record voice messages.");
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      startedAtRef.current = Date.now();
      setElapsed(0);
      setRecording(newRecording);
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - startedAtRef.current);
      }, 200);
    } catch (err) {
      Alert.alert("Recording failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const stopRecording = async (cancel: boolean) => {
    const active = recording;
    if (!active) return;
    setBusy(true);
    try {
      await active.stopAndUnloadAsync();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      const uri = active.getURI();
      setRecording(null);
      setElapsed(0);
      if (cancel || !uri) return;
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const dataUrl = `data:audio/m4a;base64,${base64}`;
      onRecorded(dataUrl);
    } catch (err) {
      Alert.alert("Recording failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setRecording(null);
    }
  };

  if (recording) {
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
