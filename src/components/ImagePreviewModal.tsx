import { Alert, Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";

type Props = {
  url: string | null;
  onClose: () => void;
};

export function ImagePreviewModal({ url, onClose }: Props) {
  const handleDownload = async () => {
    if (!url) return;
    if (Platform.OS === "web") {
      Linking.openURL(url).catch(() => {});
      return;
    }
    try {
      const filename = url.split("/").pop() || `download-${Date.now()}.jpg`;
      const dest = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory}${filename}`;
      const result = await FileSystem.downloadAsync(url, dest);
      Alert.alert("Saved", `Image saved to: ${result.uri}`);
    } catch (err) {
      Alert.alert("Download failed", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal visible={!!url} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.actions}>
          <Pressable style={styles.actionBtn} onPress={handleDownload} accessibilityLabel="Download image">
            <Ionicons name="download" size={20} color="#ffffff" />
            <Text style={styles.actionLabel}>Save</Text>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={onClose} accessibilityLabel="Close preview">
            <Ionicons name="close" size={22} color="#ffffff" />
          </Pressable>
        </View>
        {url ? (
          <Image source={{ uri: url }} style={styles.image} resizeMode="contain" />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "92%",
    height: "82%",
  },
  actions: {
    position: "absolute",
    top: 36,
    right: 16,
    flexDirection: "row",
    gap: 12,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 999,
  },
  actionLabel: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 13,
  },
});
