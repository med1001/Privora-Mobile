import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { MAX_UPLOAD_BYTES, UploadAsset, UploadResponse, uploadAttachment } from "../services/api";

type Props = {
  getToken: () => Promise<string>;
  disabled: boolean;
  onUploaded: (data: { url: string; filename?: string; mimeType?: string }) => void;
};

function deriveMime(asset: { mimeType?: string | null; type?: string | null; uri: string }): string {
  if (asset.mimeType) return asset.mimeType;
  if (asset.type === "image") return "image/jpeg";
  const ext = asset.uri.split(".").pop()?.toLowerCase();
  if (!ext) return "application/octet-stream";
  if (["jpg", "jpeg"].includes(ext)) return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  if (ext === "mp4") return "video/mp4";
  if (ext === "mp3") return "audio/mpeg";
  return "application/octet-stream";
}

export function AttachmentMenu({ getToken, disabled, onUploaded }: Props) {
  const [busy, setBusy] = useState<"none" | "image" | "camera" | "file">("none");

  const pushUpload = async (asset: UploadAsset, response: UploadResponse) => {
    onUploaded({
      url: response.url,
      filename: response.filename ?? asset.name,
      mimeType: response.type ?? asset.mimeType,
    });
  };

  const handleFromGallery = async () => {
    if (busy !== "none" || disabled) return;
    setBusy("image");
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission required", "Privora needs photo access to send images.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsEditing: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) return;
      if (asset.fileSize && asset.fileSize > MAX_UPLOAD_BYTES) {
        Alert.alert("File too large", "Max 10 MB.");
        return;
      }
      const upload: UploadAsset = {
        uri: asset.uri,
        name: asset.fileName || `image-${Date.now()}.jpg`,
        mimeType: deriveMime(asset),
      };
      const token = await getToken();
      const response = await uploadAttachment(upload, token);
      await pushUpload(upload, response);
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("none");
    }
  };

  const handleFromCamera = async () => {
    if (busy !== "none" || disabled) return;
    setBusy("camera");
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission required", "Privora needs camera access to take pictures.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsEditing: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) return;
      const upload: UploadAsset = {
        uri: asset.uri,
        name: asset.fileName || `photo-${Date.now()}.jpg`,
        mimeType: deriveMime(asset),
      };
      const token = await getToken();
      const response = await uploadAttachment(upload, token);
      await pushUpload(upload, response);
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("none");
    }
  };

  const handleFromFiles = async () => {
    if (busy !== "none" || disabled) return;
    setBusy("file");
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) return;
      if (asset.size && asset.size > MAX_UPLOAD_BYTES) {
        Alert.alert("File too large", "Max 10 MB.");
        return;
      }
      const upload: UploadAsset = {
        uri: asset.uri,
        name: asset.name || `file-${Date.now()}`,
        mimeType: asset.mimeType || deriveMime({ uri: asset.uri }),
      };
      const token = await getToken();
      const response = await uploadAttachment(upload, token);
      await pushUpload(upload, response);
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("none");
    }
  };

  return (
    <View style={styles.row}>
      <Pressable
        onPress={handleFromCamera}
        style={[styles.btn, (disabled || busy !== "none") && styles.btnDisabled]}
        accessibilityLabel="Open camera"
        disabled={disabled || busy !== "none"}
      >
        {busy === "camera" ? (
          <ActivityIndicator size="small" color="#2563eb" />
        ) : (
          <Ionicons name="camera-outline" size={20} color={disabled ? "#cbd5e1" : "#6b7280"} />
        )}
      </Pressable>
      <Pressable
        onPress={handleFromGallery}
        style={[styles.btn, (disabled || busy !== "none") && styles.btnDisabled]}
        accessibilityLabel="Pick image"
        disabled={disabled || busy !== "none"}
      >
        {busy === "image" ? (
          <ActivityIndicator size="small" color="#2563eb" />
        ) : (
          <Ionicons name="image-outline" size={20} color={disabled ? "#cbd5e1" : "#6b7280"} />
        )}
      </Pressable>
      <Pressable
        onPress={handleFromFiles}
        style={[styles.btn, (disabled || busy !== "none") && styles.btnDisabled]}
        accessibilityLabel="Pick file"
        disabled={disabled || busy !== "none"}
      >
        {busy === "file" ? (
          <ActivityIndicator size="small" color="#2563eb" />
        ) : (
          <Ionicons name="attach-outline" size={20} color={disabled ? "#cbd5e1" : "#6b7280"} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
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
});
