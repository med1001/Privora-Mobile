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
import Constants from "expo-constants";
import { useAuth } from "../context/AuthContext";

const LOGO = require("../../assets/logo.png");

function getExtraRegisterUrl(): string | undefined {
  const extra = Constants.expoConfig?.extra as { registerUrl?: string } | undefined;
  const url = extra?.registerUrl?.trim();
  return url || undefined;
}

export function LoginScreen() {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const registerUrl = getExtraRegisterUrl();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phrases = [
    "No cookies.",
    "No ads.",
    "Secure end-to-end encryption.",
    "No moderation or manipulation.",
    "100% open source — nothing to hide.",
  ];
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [typing, setTyping] = useState(true);

  const canSubmit = useMemo(() => email.trim().length > 4 && password.length > 5, [email, password]);

  useEffect(() => {
    const currentPhrase = phrases[phraseIndex];
    const atEnd = typing && displayedText.length === currentPhrase.length;
    const delay = atEnd ? 2000 : typing ? 100 : displayedText.length > 0 ? 50 : 0;

    const timeout = setTimeout(() => {
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
    }, delay);

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

  const openRegister = () => {
    if (!registerUrl) return;
    void Linking.openURL(registerUrl);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        <View style={styles.stack}>
          <View style={styles.heroBlock}>
            <Image source={LOGO} style={styles.logo} resizeMode="contain" />
            <View style={styles.phraseBox}>
              <Text style={styles.heroTyping}>
                {displayedText}
                <Text style={styles.cursor}>|</Text>
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.loginTitle}>Login</Text>

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
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>Login</Text>
              )}
            </Pressable>

            <View style={styles.registerRow}>
              <Text style={styles.registerMuted}>Don't have an account? </Text>
              {registerUrl ? (
                <Pressable onPress={openRegister} hitSlop={8}>
                  <Text style={styles.registerLink}>Register here</Text>
                </Pressable>
              ) : (
                <Text style={styles.registerLinkMuted}>Register here</Text>
              )}
            </View>
          </View>
        </View>

        <Text style={styles.footerText}>
          Made with ❤️ by MedBenMoussa &nbsp;|&nbsp;{" "}
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
    backgroundColor: "#f9fafb",
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 32,
    justifyContent: "space-between",
  },
  stack: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
    gap: 28,
  },
  heroBlock: {
    alignItems: "center",
    width: "100%",
  },
  logo: {
    width: 144,
    height: 144,
    marginBottom: 4,
  },
  phraseBox: {
    minHeight: 64,
    width: "100%",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  heroTyping: {
    color: "#374151",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    textAlign: "center",
  },
  cursor: {
    fontWeight: "100",
    fontSize: 22,
    color: "#666666",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 24,
    gap: 16,
    width: "100%",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  loginTitle: {
    color: "#1f2937",
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 0,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#f8fafc",
  },
  button: {
    marginTop: 4,
    backgroundColor: "#2563eb",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    minHeight: 48,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    color: "#ef4444",
    fontSize: 14,
  },
  registerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
  },
  registerMuted: {
    color: "#4b5563",
    fontSize: 14,
    textAlign: "center",
  },
  registerLink: {
    color: "#3b82f6",
    fontSize: 14,
    fontWeight: "500",
  },
  registerLinkMuted: {
    color: "#93c5fd",
    fontSize: 14,
    fontWeight: "500",
  },
  footerText: {
    textAlign: "center",
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 40,
    lineHeight: 18,
  },
  footerLink: {
    color: "#60a5fa",
    textDecorationLine: "underline",
  },
});
