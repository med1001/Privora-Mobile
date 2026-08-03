import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { useAuth } from "../context/AuthContext";

type Props = NativeStackScreenProps<RootStackParamList, "Register">;

export function RegisterScreen({ navigation }: Props) {
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmit = useMemo(
    () =>
      displayName.trim().length >= 2 &&
      email.trim().length > 4 &&
      password.length >= 6 &&
      password === confirmPassword,
    [confirmPassword, displayName, email, password],
  );

  const onSubmit = async () => {
    if (busy) return;
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!canSubmit) {
      setError("Enter a name, a valid email, and a password of at least 6 characters.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await register(displayName, email, password);
      setNotice("Account created. Check your inbox and spam folder, then verify your email before logging in.");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.title}>Create your Privora account</Text>
            <Text style={styles.subtitle}>Your email must be verified before your first login.</Text>

            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Display name"
              placeholderTextColor="#94a3b8"
              autoCapitalize="words"
              autoComplete="name"
              style={styles.input}
              editable={!busy}
            />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor="#94a3b8"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              style={styles.input}
              editable={!busy}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor="#94a3b8"
              secureTextEntry
              autoComplete="new-password"
              style={styles.input}
              editable={!busy}
            />
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm password"
              placeholderTextColor="#94a3b8"
              secureTextEntry
              autoComplete="new-password"
              style={styles.input}
              editable={!busy}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Pressable
              onPress={() => void onSubmit()}
              disabled={!canSubmit || busy}
              style={[styles.button, (!canSubmit || busy) && styles.disabledButton]}
            >
              {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Register</Text>}
            </Pressable>

            <Pressable onPress={() => navigation.navigate("Login")} style={styles.loginLink}>
              <Text style={styles.loginLinkText}>Already registered? Back to login</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: "#f8fafc" },
  content: { flexGrow: 1, justifyContent: "center", padding: 20 },
  card: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 22,
    gap: 14,
    shadowColor: "#000000",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  title: { color: "#0f172a", fontSize: 23, fontWeight: "700", textAlign: "center" },
  subtitle: { color: "#64748b", fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    color: "#0f172a",
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  error: { color: "#dc2626", fontSize: 14 },
  notice: { color: "#15803d", fontSize: 14, lineHeight: 20 },
  button: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
  },
  disabledButton: { opacity: 0.5 },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  loginLink: { alignItems: "center", paddingVertical: 8 },
  loginLinkText: { color: "#2563eb", fontSize: 14, fontWeight: "500" },
});
