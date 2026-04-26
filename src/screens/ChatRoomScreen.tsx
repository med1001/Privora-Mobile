import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { RootStackParamList } from "../navigation/RootNavigator";
import { useChatSession } from "../hooks/useChatSession";
import { useAuth } from "../context/AuthContext";

type Props = NativeStackScreenProps<RootStackParamList, "ChatRoom"> & {
  session: ReturnType<typeof useChatSession>;
};

export function ChatRoomScreen({ route, session }: Props) {
  const { user } = useAuth();
  const [draft, setDraft] = useState("");
  const localUserId = user?.email ?? user?.uid ?? "";

  useEffect(() => {
    if (session.selectedChatUserId !== route.params.userId) {
      session.setSelectedChatUserId(route.params.userId);
    }
  }, [route.params.userId, session]);

  const messages = session.selectedChatUserId === route.params.userId ? session.selectedMessages : [];

  const onSend = () => {
    if (!draft.trim()) return;
    const ok = session.sendMessage(draft);
    if (ok) setDraft("");
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const mine = item.senderId === localUserId;
          return (
            <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer]}>
              <Text style={[styles.messageText, mine && { color: "#fff" }]}>{item.text}</Text>
              <Text style={[styles.timestamp, mine && { color: "#dbeafe" }]}>
                {new Date(item.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>
          );
        }}
      />

      <View style={styles.inputRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a message..."
          style={styles.input}
          onSubmitEditing={onSend}
        />
        <Pressable style={styles.send} onPress={onSend}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  list: { padding: 12, gap: 8 },
  bubble: {
    maxWidth: "85%",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  bubbleMine: {
    marginLeft: "auto",
    backgroundColor: "#2563eb",
  },
  bubblePeer: {
    marginRight: "auto",
    backgroundColor: "#f3f4f6",
  },
  messageText: {
    color: "#111827",
    fontSize: 15,
  },
  timestamp: {
    marginTop: 4,
    fontSize: 11,
    color: "#6b7280",
  },
  inputRow: {
    borderTopWidth: 1,
    borderColor: "#e5e7eb",
    flexDirection: "row",
    gap: 8,
    padding: 10,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  send: {
    backgroundColor: "#2563eb",
    borderRadius: 10,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  sendText: {
    color: "#fff",
    fontWeight: "700",
  },
});
