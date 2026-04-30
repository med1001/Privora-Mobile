import { ReactElement, useEffect, useRef, useState } from "react";
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import { ReactionPicker } from "./ReactionPicker";
import { ChatMessage } from "../types/chat";
import { buildAssetUrl } from "../services/api";

type Props = {
  message: ChatMessage;
  mine: boolean;
  revealed: boolean;
  onToggleReveal: () => void;
  onReact: (emoji: string) => void;
  onPreviewImage: (url: string) => void;
  onRetry?: () => void;
  /**
   * If true, the reaction picker is rendered below the bubble instead of
   * above. We use this for the topmost messages of the list so the picker
   * is not occluded by the chat header.
   */
  pickerBelow?: boolean;
};

const SYSTEM_IMAGE_PREFIX = "__system_image:";
const SYSTEM_FILE_PREFIX = "__system_file:";
const SYSTEM_AUDIO_PREFIX = "__system_audio:";

function formatTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) return "";
  try {
    const safe = timestamp.endsWith("Z") || timestamp.includes("+") ? timestamp : `${timestamp}Z`;
    const date = new Date(safe);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString([], {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function AudioPlayer({ source, mine }: { source: string; mine: boolean }) {
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Make sure to release native audio resources when the bubble unmounts to
  // avoid leaking decoders or fighting the call audio session.
  useEffect(() => {
    return () => {
      const existing = soundRef.current;
      soundRef.current = null;
      if (existing) {
        existing.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const stop = async () => {
    const existing = soundRef.current;
    soundRef.current = null;
    if (existing) {
      try {
        await existing.stopAsync();
      } catch {}
      try {
        await existing.unloadAsync();
      } catch {}
    }
    setPlaying(false);
  };

  const resolvePlayableUri = async (raw: string) => {
    if (!raw.startsWith("data:")) return raw;
    // AVPlayer (iOS) does not always honour data: URIs reliably, so we
    // persist the base64 payload to a tmp file and play that file instead.
    const match = raw.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return raw;
    const mime = match[1];
    const payload = match[2];
    const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "mp4" : mime.includes("mpeg") ? "mp3" : "m4a";
    const path = `${FileSystem.cacheDirectory}voice-${Date.now()}.${ext}`;
    await FileSystem.writeAsStringAsync(path, payload, { encoding: FileSystem.EncodingType.Base64 });
    return path;
  };

  const play = async () => {
    try {
      const playable = await resolvePlayableUri(source);
      const { sound: created } = await Audio.Sound.createAsync({ uri: playable }, { shouldPlay: true });
      soundRef.current = created;
      setPlaying(true);
      created.setOnPlaybackStatusUpdate((status) => {
        if ("didJustFinish" in status && status.didJustFinish) {
          void stop();
        }
      });
    } catch {
      setPlaying(false);
    }
  };

  return (
    <View style={[styles.audioRow, mine ? styles.audioRowMine : null]}>
      <Pressable
        style={[styles.audioBtn, mine ? styles.audioBtnMine : styles.audioBtnPeer]}
        onPress={() => (playing ? stop() : play())}
        accessibilityLabel={playing ? "Pause voice message" : "Play voice message"}
      >
        <Ionicons name={playing ? "pause" : "play"} size={16} color={mine ? "#1d4ed8" : "#1f2937"} />
      </Pressable>
      <Text style={[styles.audioLabel, mine && styles.audioLabelMine]}>Voice message</Text>
    </View>
  );
}

export function MessageBubble({
  message,
  mine,
  revealed,
  onToggleReveal,
  onReact,
  onPreviewImage,
  onRetry,
  pickerBelow = false,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const reactions = message.reactions ?? {};
  const reactionEntries = Object.entries(reactions);
  const text = message.text;

  const isImage = text.startsWith(SYSTEM_IMAGE_PREFIX);
  const isFile = text.startsWith(SYSTEM_FILE_PREFIX);
  const isAudio = text.startsWith(SYSTEM_AUDIO_PREFIX);

  let content: ReactElement;
  if (isImage) {
    const path = text.slice(SYSTEM_IMAGE_PREFIX.length);
    const url = buildAssetUrl(path);
    content = (
      <Pressable onPress={() => onPreviewImage(url)} style={styles.imagePressable}>
        <Image source={{ uri: url }} style={styles.image} resizeMode="cover" />
      </Pressable>
    );
  } else if (isFile) {
    const payload = text.slice(SYSTEM_FILE_PREFIX.length);
    const [path, name] = payload.split("|");
    const url = buildAssetUrl(path);
    const filename = name || "Attachment";
    content = (
      <Pressable
        style={styles.fileRow}
        onPress={() => Linking.openURL(url)}
        accessibilityLabel={`Open file ${filename}`}
      >
        <Ionicons name="document-attach" size={18} color={mine ? "#ffffff" : "#2563eb"} />
        <Text style={[styles.fileName, mine && styles.fileNameMine]} numberOfLines={1}>
          {filename}
        </Text>
      </Pressable>
    );
  } else if (isAudio) {
    const audioPayload = text.slice(SYSTEM_AUDIO_PREFIX.length);
    // Web stores audio either as a data URL or a relative path; both are
    // accepted by the player. We let buildAssetUrl turn relative ones into
    // absolute http(s) URLs, leaving data: payloads untouched.
    const source = audioPayload.startsWith("data:") ? audioPayload : buildAssetUrl(audioPayload);
    content = <AudioPlayer source={source} mine={mine} />;
  } else {
    content = (
      <Text style={[styles.text, mine && styles.textMine]} selectable>
        {text}
      </Text>
    );
  }

  const handleLongPress = () => {
    setPickerOpen(true);
  };

  const handlePress = () => {
    if (pickerOpen) {
      setPickerOpen(false);
      return;
    }
    onToggleReveal();
  };

  return (
    <View style={[styles.outer, mine ? styles.outerMine : styles.outerPeer]}>
      <Pressable
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubblePeer,
          isImage && styles.bubbleImage,
          message.status === "failed" && styles.bubbleFailed,
        ]}
        onLongPress={handleLongPress}
        delayLongPress={350}
        onPress={handlePress}
      >
        {content}

        {pickerOpen && (
          <ReactionPicker
            align={mine ? "end" : "start"}
            position={pickerBelow ? "below" : "above"}
            onPick={(emoji) => {
              setPickerOpen(false);
              onReact(emoji);
            }}
          />
        )}

        {reactionEntries.length > 0 && (
          <View style={[styles.reactionsRow, mine ? styles.reactionsMine : styles.reactionsPeer]}>
            {Object.entries(
              reactionEntries.reduce<Record<string, number>>((acc, [, emoji]) => {
                acc[emoji] = (acc[emoji] ?? 0) + 1;
                return acc;
              }, {}),
            ).map(([emoji, count]) => (
              <View key={emoji} style={styles.reactionPill}>
                <Text style={styles.reactionEmoji}>{emoji}</Text>
                {count > 1 && <Text style={styles.reactionCount}>{count}</Text>}
              </View>
            ))}
          </View>
        )}
      </Pressable>

      {revealed && (
        <Text style={[styles.timestamp, mine ? styles.timestampMine : styles.timestampPeer]}>
          {formatTimestamp(message.timestamp)}
        </Text>
      )}

      {message.status === "failed" && (
        <Pressable onPress={onRetry} style={styles.failedRow} accessibilityLabel="Retry sending message">
          <Ionicons name="alert-circle" size={12} color="#dc2626" />
          <Text style={styles.failedText}>Failed - tap to retry</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    maxWidth: "80%",
    marginVertical: 4,
  },
  outerMine: {
    alignSelf: "flex-end",
  },
  outerPeer: {
    alignSelf: "flex-start",
  },
  bubble: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: "relative",
  },
  bubbleMine: {
    backgroundColor: "#2563eb",
    borderBottomRightRadius: 4,
  },
  bubblePeer: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderBottomLeftRadius: 4,
  },
  bubbleImage: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  bubbleFailed: {
    opacity: 0.85,
  },
  text: {
    color: "#111827",
    fontSize: 15,
  },
  textMine: {
    color: "#ffffff",
  },
  imagePressable: {
    borderRadius: 10,
    overflow: "hidden",
  },
  image: {
    width: 220,
    height: 220,
    borderRadius: 10,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  fileName: {
    color: "#1f2937",
    fontSize: 14,
    fontWeight: "600",
    maxWidth: 200,
  },
  fileNameMine: {
    color: "#ffffff",
  },
  audioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 2,
    minWidth: 160,
  },
  audioRowMine: {},
  audioBtn: {
    width: 30,
    height: 30,
    borderRadius: 99,
    alignItems: "center",
    justifyContent: "center",
  },
  audioBtnMine: {
    backgroundColor: "#ffffff",
  },
  audioBtnPeer: {
    backgroundColor: "#dbeafe",
  },
  audioLabel: {
    color: "#1f2937",
    fontSize: 13,
    fontWeight: "600",
  },
  audioLabelMine: {
    color: "#ffffff",
  },
  reactionsRow: {
    position: "absolute",
    bottom: -12,
    flexDirection: "row",
    gap: 4,
  },
  reactionsMine: {
    right: 6,
  },
  reactionsPeer: {
    left: 6,
  },
  reactionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "#ffffff",
    borderColor: "#e5e7eb",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  reactionEmoji: {
    fontSize: 12,
  },
  reactionCount: {
    fontSize: 11,
    color: "#6b7280",
  },
  timestamp: {
    fontSize: 10,
    color: "#9ca3af",
    marginTop: 2,
  },
  timestampMine: {
    alignSelf: "flex-end",
  },
  timestampPeer: {
    alignSelf: "flex-start",
  },
  failedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
    alignSelf: "flex-end",
  },
  failedText: {
    color: "#dc2626",
    fontSize: 11,
    fontWeight: "600",
  },
});
