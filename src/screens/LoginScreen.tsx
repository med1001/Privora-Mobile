import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Linking,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";

export function LoginScreen() {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phrases = [
    "No cookies.",
    "No ads.",
    "Secure end-to-end encryption.",
    "No moderation or manipulation.",
    "100% open source - nothing to hide.",
  ];
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [typing, setTyping] = useState(true);

  const canSubmit = useMemo(() => email.trim().length > 4 && password.length > 5, [email, password]);

  useEffect(() => {
    const currentPhrase = phrases[phraseIndex];
    const timeout = setTimeout(
      () => {
        if (typing) {
          if (displayedText.length < currentPhrase.length) {
            setDisplayedText(currentPhrase.slice(0, displayedText.length + 1));
          } else {
            setTyping(false);
          }
        } else if (displayedText.length > 0) {
          setDisplayedText(currentPhrase.slice(0, displayedText.length - 1));
        } else {
          setTyping(true);
          setPhraseIndex((prev) => (prev + 1) % phrases.length);
        }
      },
      typing && displayedText.length === currentPhrase.length ? 1400 : typing ? 55 : 30,
    );

    return () => clearTimeout(timeout);
  }, [displayedText, phraseIndex, phrases, typing]);

  const onSubmit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.heroWrap}>
          <View style={styles.logoWrap}>
            <Image
              source={{ uri: "https://raw.githubusercontent.com/med1001/Privora-GUI/main/public/logo.png" }}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.heroTyping}>
            {displayedText}
            <Text style={styles.cursor}>|</Text>
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.loginTitle}>Login</Text>
          <Text style={styles.subtitle}>Sign in with your existing account</Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            placeholder="Email"
            placeholderTextColor="#9ca3af"
            style={styles.input}
            editable={!busy}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            autoComplete="password"
            placeholder="Password"
            placeholderTextColor="#9ca3af"
            style={styles.input}
            editable={!busy}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.button, (!canSubmit || busy) && styles.buttonDisabled]}
            onPress={onSubmit}
            disabled={!canSubmit || busy}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Login</Text>}
          </Pressable>
        </View>

        <Text style={[styles.footerText, { marginBottom: Math.max(insets.bottom, 8) }]}>
          Made with ❤️ by MedBenMoussa |{" "}
          <Text
            style={styles.footerLink}
            onPress={() => {
              void Linking.openURL("https://github.com/med1001/Privora");
            }}
          >
            View on GitHub
          </Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f3f6fc",
    justifyContent: "center",
    padding: 20,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "space-between",
    gap: 16,
    paddingTop: 24,
  },
  heroWrap: {
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  logoWrap: {
    width: 124,
    height: 124,
    alignItems: "center",
    justifyContent: "center",
  },
  logoImage: {
    width: 124,
    height: 124,
  },
  heroTyping: {
    minHeight: 26,
    color: "#475569",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    textAlign: "center",
  },
  cursor: {
    color: "#64748b",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: "#dbeafe",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  loginTitle: {
    color: "#1f2937",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: "#4b5563",
    marginBottom: 6,
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#111827",
    backgroundColor: "#ffffff",
  },
  button: {
    marginTop: 8,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
  },
  error: {
    color: "#dc2626",
  },
  footerText: {
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 12,
  },
  footerLink: {
    color: "#60a5fa",
    textDecorationLine: "underline",
  },
});
