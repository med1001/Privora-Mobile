import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import {
  buildAssetUrl,
  contactSupport,
  deletePrivoraAccount,
  fetchSettingsProfile,
  reportIssue,
  type SettingsProfile,
  uploadProfilePhoto,
} from "../services/api";

type Props = {
  visible: boolean;
  onClose: () => void;
  onProfileUpdated: (profile: SettingsProfile) => void;
};

type FormKind = "contact" | "issue";

export function SettingsModal({ visible, onClose, onProfileUpdated }: Props) {
  const { getIdToken, logout, user } = useAuth();
  const [profile, setProfile] = useState<SettingsProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [contactSubject, setContactSubject] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [issueSubject, setIssueSubject] = useState("");
  const [issueMessage, setIssueMessage] = useState("");
  const [submitting, setSubmitting] = useState<FormKind | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [status, setStatus] = useState<{ kind: FormKind | "profile"; message: string; error?: boolean } | null>(
    null,
  );

  const effectiveProfile = profile ?? {
    userId: user?.email || user?.uid || "",
    displayName: user?.displayName || user?.email?.split("@")[0] || "User",
    photoURL: user?.photoURL || null,
  };
  const initials = useMemo(
    () =>
      effectiveProfile.displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "U",
    [effectiveProfile.displayName],
  );
  const avatarUrl = effectiveProfile.photoURL ? buildAssetUrl(effectiveProfile.photoURL) : "";

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoadingProfile(true);
    setStatus(null);
    void (async () => {
      try {
        const token = await getIdToken();
        const nextProfile = await fetchSettingsProfile(token);
        if (!cancelled) {
          setProfile(nextProfile);
          onProfileUpdated(nextProfile);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus({
            kind: "profile",
            message: err instanceof Error ? err.message : "Could not load your profile.",
            error: true,
          });
        }
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getIdToken, onProfileUpdated, visible]);

  const pickProfilePhoto = async () => {
    setStatus(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStatus({ kind: "profile", message: "Photo library permission is required.", error: true });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;

    setUploadingPhoto(true);
    try {
      const token = await getIdToken();
      const response = await uploadProfilePhoto(
        {
          uri: asset.uri,
          name: asset.fileName || `profile-${Date.now()}.jpg`,
          mimeType: asset.mimeType || "image/jpeg",
        },
        token,
      );
      setProfile(response.user);
      onProfileUpdated(response.user);
      await user?.reload();
      setStatus({ kind: "profile", message: response.message || "Profile picture updated." });
    } catch (err) {
      setStatus({
        kind: "profile",
        message: err instanceof Error ? err.message : "Could not update profile picture.",
        error: true,
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const submitForm = async (kind: FormKind) => {
    const subject = kind === "contact" ? contactSubject.trim() : issueSubject.trim();
    const message = kind === "contact" ? contactMessage.trim() : issueMessage.trim();
    if (subject.length < 3 || message.length < 10) {
      setStatus({
        kind,
        message: "Use at least 3 characters for the subject and 10 for the message.",
        error: true,
      });
      return;
    }

    setSubmitting(kind);
    setStatus(null);
    try {
      const token = await getIdToken();
      const response =
        kind === "contact"
          ? await contactSupport(subject, message, token)
          : await reportIssue(subject, message, token);
      if (kind === "contact") {
        setContactSubject("");
        setContactMessage("");
      } else {
        setIssueSubject("");
        setIssueMessage("");
      }
      setStatus({ kind, message: response.message });
    } catch (err) {
      setStatus({
        kind,
        message: err instanceof Error ? err.message : "Request failed.",
        error: true,
      });
    } finally {
      setSubmitting(null);
    }
  };

  const statusText = (kind: FormKind | "profile") =>
    status?.kind === kind ? (
      <Text style={[styles.statusText, status.error && styles.errorText]}>{status.message}</Text>
    ) : null;

  const confirmAccountDeletion = () => {
    Alert.alert(
      "Delete Privora account?",
      "This permanently deletes your account, profile, messages and associated Privora data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete permanently",
          style: "destructive",
          onPress: () => {
            setDeletingAccount(true);
            setStatus(null);
            void (async () => {
              try {
                const token = await getIdToken();
                await deletePrivoraAccount(token);
                onClose();
                await logout();
              } catch (err) {
                setStatus({
                  kind: "profile",
                  message: err instanceof Error ? err.message : "Could not delete your account.",
                  error: true,
                });
              } finally {
                setDeletingAccount(false);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Settings</Text>
            <Text style={styles.subtitle}>Profile, support, and issue reporting</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton} accessibilityLabel="Close settings">
            <Ionicons name="close" size={24} color="#334155" />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.card}>
              <View style={styles.profileRow}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                )}
                <View style={styles.profileCopy}>
                  <Text style={styles.profileName}>{effectiveProfile.displayName}</Text>
                  <Text style={styles.profileEmail}>{effectiveProfile.userId}</Text>
                </View>
              </View>
              <Pressable
                style={[styles.primaryButton, (uploadingPhoto || loadingProfile) && styles.disabledButton]}
                disabled={uploadingPhoto || loadingProfile}
                onPress={() => void pickProfilePhoto()}
              >
                {uploadingPhoto || loadingProfile ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Ionicons name="camera-outline" size={18} color="#ffffff" />
                )}
                <Text style={styles.primaryButtonText}>
                  {uploadingPhoto ? "Uploading..." : "Change profile picture"}
                </Text>
              </Pressable>
              {statusText("profile")}
            </View>

            <SupportForm
              icon="mail-outline"
              title="Contact us"
              subject={contactSubject}
              message={contactMessage}
              subjectPlaceholder="Subject"
              messagePlaceholder="How can we help?"
              buttonLabel="Send message"
              destructive={false}
              busy={submitting === "contact"}
              onSubjectChange={setContactSubject}
              onMessageChange={setContactMessage}
              onSubmit={() => void submitForm("contact")}
            />
            {statusText("contact")}

            <SupportForm
              icon="warning-outline"
              title="Report issue"
              subject={issueSubject}
              message={issueMessage}
              subjectPlaceholder="Issue summary"
              messagePlaceholder="What happened, and how can it be reproduced?"
              buttonLabel="Submit issue"
              destructive
              busy={submitting === "issue"}
              onSubjectChange={setIssueSubject}
              onMessageChange={setIssueMessage}
              onSubmit={() => void submitForm("issue")}
            />
            {statusText("issue")}

            <View style={styles.card}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#0f172a" />
                <Text style={styles.sectionTitle}>Privacy and account</Text>
              </View>
              <Pressable onPress={() => void Linking.openURL("https://www.privora-app.com/privacy")}>
                <Text style={styles.linkText}>Privacy policy</Text>
              </Pressable>
              <Pressable onPress={() => void Linking.openURL("https://www.privora-app.com/delete-account")}>
                <Text style={styles.linkText}>Account deletion information</Text>
              </Pressable>
              <Pressable onPress={() => void Linking.openURL("mailto:privora.support.app@gmail.com")}>
                <Text style={styles.linkText}>privora.support.app@gmail.com</Text>
              </Pressable>
              <Text style={styles.dangerDescription}>
                Deleting your account permanently removes your profile, messages and associated Privora data.
              </Text>
              <Pressable
                onPress={confirmAccountDeletion}
                disabled={deletingAccount}
                style={[styles.formButton, styles.destructiveButton, deletingAccount && styles.disabledButton]}
              >
                {deletingAccount ? <ActivityIndicator color="#ffffff" /> : null}
                <Text style={styles.primaryButtonText}>
                  {deletingAccount ? "Deleting…" : "Delete account"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

type SupportFormProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subject: string;
  message: string;
  subjectPlaceholder: string;
  messagePlaceholder: string;
  buttonLabel: string;
  destructive: boolean;
  busy: boolean;
  onSubjectChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSubmit: () => void;
};

function SupportForm(props: SupportFormProps) {
  return (
    <View style={styles.card}>
      <View style={styles.sectionTitleRow}>
        <Ionicons name={props.icon} size={20} color="#0f172a" />
        <Text style={styles.sectionTitle}>{props.title}</Text>
      </View>
      <TextInput
        value={props.subject}
        onChangeText={props.onSubjectChange}
        placeholder={props.subjectPlaceholder}
        placeholderTextColor="#94a3b8"
        maxLength={120}
        style={styles.input}
      />
      <TextInput
        value={props.message}
        onChangeText={props.onMessageChange}
        placeholder={props.messagePlaceholder}
        placeholderTextColor="#94a3b8"
        maxLength={5000}
        multiline
        textAlignVertical="top"
        style={[styles.input, styles.messageInput]}
      />
      <Pressable
        onPress={props.onSubmit}
        disabled={props.busy}
        style={[
          styles.formButton,
          props.destructive ? styles.destructiveButton : styles.darkButton,
          props.busy && styles.disabledButton,
        ]}
      >
        {props.busy ? <ActivityIndicator color="#ffffff" /> : null}
        <Text style={styles.primaryButtonText}>{props.busy ? "Sending..." : props.buttonLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: "#f8fafc" },
  header: {
    minHeight: 72,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: "#ffffff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#cbd5e1",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: "#0f172a", fontSize: 22, fontWeight: "700" },
  subtitle: { color: "#64748b", fontSize: 13, marginTop: 2 },
  closeButton: { padding: 8, borderRadius: 20, backgroundColor: "#f1f5f9" },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  card: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#dbeafe" },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#1d4ed8", fontSize: 24, fontWeight: "700" },
  profileCopy: { flex: 1 },
  profileName: { color: "#0f172a", fontSize: 18, fontWeight: "700" },
  profileEmail: { color: "#64748b", fontSize: 13, marginTop: 3 },
  primaryButton: {
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: "#2563eb",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  disabledButton: { opacity: 0.55 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { color: "#0f172a", fontSize: 17, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    color: "#0f172a",
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  messageInput: { minHeight: 120 },
  formButton: {
    minHeight: 46,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  darkButton: { backgroundColor: "#0f172a" },
  destructiveButton: { backgroundColor: "#dc2626" },
  statusText: { color: "#15803d", fontSize: 14, paddingHorizontal: 4 },
  errorText: { color: "#dc2626" },
  linkText: { color: "#2563eb", fontSize: 15, fontWeight: "600" },
  dangerDescription: { color: "#64748b", fontSize: 14, lineHeight: 20 },
});
