import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { RootStackParamList } from "../navigation/RootNavigator";
import { useChatSession } from "../hooks/useChatSession";
import type { CallState } from "../hooks/useWebRTCCall";
import { searchUsers } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { MessageBubble } from "../components/MessageBubble";
import { AttachmentMenu } from "../components/AttachmentMenu";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { ImagePreviewModal } from "../components/ImagePreviewModal";

type CallControls = {
  callState: CallState;
  isMuted: boolean;
  toggleMute: () => void;
  initiateCall: (peerId: string, peerName: string) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  endCall: () => void;
};

type Props = NativeStackScreenProps<RootStackParamList, "ChatList"> & {
  session: ReturnType<typeof useChatSession>;
  call?: CallControls;
};

export function ChatListScreen({ session, call }: Props) {
  const { getIdToken, logout, user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ userId: string; displayName: string }>>([]);
  const [draft, setDraft] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [revealedMessageId, setRevealedMessageId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const drawerTranslateX = useRef(new Animated.Value(-340)).current;
  const messageListRef = useRef<FlatList>(null);

  const isDesktopLike = width >= 900;
  const contacts = useMemo(() => session.contacts, [session.contacts]);
  const selectedContact = contacts.find((item) => item.userId === session.selectedChatUserId) ?? null;
  const messages = selectedContact ? session.selectedMessages : [];
  const profileLabelSource = (user?.displayName || user?.email || "User").trim();
  const localUserId = user?.email || user?.uid || "";
  const initials = profileLabelSource
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";

  const toDisplayName = (rawDisplayName: string | null | undefined, userId: string) => {
    const value = (rawDisplayName || "").trim();
    if (!value) return userId;
    if (value.includes("@")) {
      const localPart = value.split("@")[0];
      const base = localPart.split("+")[0];
      return base || value;
    }
    return value;
  };

  const isLocalMessage = (senderId: string) => {
    const normalizedSender = senderId.trim().toLowerCase();
    return normalizedSender === (user?.email || "").trim().toLowerCase()
      || normalizedSender === (user?.uid || "").trim().toLowerCase();
  };

  const formatSystemMessage = (text: string, mine: boolean) => {
    if (!text.startsWith("__system_call:")) return null;

    const parts = text.split(":");
    if (parts[1] === "missed") {
      return mine ? "Call unanswered \u260E" : "Missed call \u260E";
    }
    if (parts[1] === "ended") {
      const minutes = parts[2] || "00";
      const seconds = parts[3] || "00";
      return `Call ended \u260E Duration: ${minutes}:${seconds}`;
    }

    return "Call information";
  };

  const formatTimestamp = (timestamp: string | null | undefined) => {
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
  };

  const runSearch = async (searchValue: string) => {
    const clean = searchValue.trim();
    if (!clean) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    setSearchError(null);
    try {
      const token = await getIdToken();
      const users = await searchUsers(clean, token);
      setSuggestions(users);
    } catch (err) {
      setSuggestions([]);
      setSearchError(err instanceof Error ? `Search failed: ${err.message}` : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(() => {
      void runSearch(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (isDesktopLike) {
      setDrawerMounted(false);
      setDrawerOpen(false);
      drawerTranslateX.setValue(-340);
      return;
    }

    if (drawerOpen) {
      setDrawerMounted(true);
      Animated.timing(drawerTranslateX, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(drawerTranslateX, {
      toValue: -340,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setDrawerMounted(false);
    });
  }, [drawerOpen, isDesktopLike, drawerTranslateX]);

  // Auto-scroll to the most recent message when the list grows or the active
  // chat changes.
  useEffect(() => {
    if (!messages.length) return;
    const id = setTimeout(() => {
      messageListRef.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(id);
  }, [messages.length, session.selectedChatUserId]);

  const onSelectContact = (userId: string, displayName?: string) => {
    if (!contacts.some((item) => item.userId === userId)) {
      session.upsertContacts([
        {
          userId,
          displayName: displayName || userId,
          online: false,
        },
      ]);
    }
    session.setSelectedChatUserId(userId);
    setDrawerOpen(false);
  };

  const onSendMessage = () => {
    if (!draft.trim()) return;
    const ok = session.sendMessage(draft);
    if (ok) setDraft("");
  };

  const handleReaction = (messageId: string, emoji: string) => {
    if (!selectedContact) return;
    session.sendReaction(messageId, selectedContact.userId, emoji);
  };

  const handleAttachmentUploaded = ({
    url,
    filename,
    mimeType,
  }: {
    url: string;
    filename?: string;
    mimeType?: string;
  }) => {
    if (!selectedContact) return;
    const isImage = (mimeType || "").startsWith("image/");
    const text = isImage
      ? `__system_image:${url}`
      : `__system_file:${url}|${filename || "Attachment"}`;
    session.sendRawMessage(text, selectedContact.userId);
  };

  const handleVoiceRecorded = (dataUrl: string) => {
    if (!selectedContact) return;
    session.sendRawMessage(`__system_audio:${dataUrl}`, selectedContact.userId);
  };

  const renderSidebar = (mobile: boolean) => (
    <View
      style={[
        styles.sidebar,
        mobile ? styles.sidebarMobile : styles.sidebarDesktop,
        mobile && {
          paddingTop: Math.max(insets.top, 0) + 12,
          paddingBottom: Math.max(insets.bottom, 0) + 12,
        },
      ]}
    >
      <View style={styles.sidebarHeader}>
        <Text style={styles.sidebarTitle}>Privora</Text>
        {mobile && (
          <Pressable onPress={() => setDrawerOpen(false)}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            if (!value.trim()) {
              setSuggestions([]);
            }
          }}
          placeholder="Search users..."
          placeholderTextColor="#94a3b8"
          style={styles.searchInput}
          onSubmitEditing={() => void runSearch(query)}
        />
      </View>

      {loading ? <ActivityIndicator color="#93c5fd" style={{ marginBottom: 8 }} /> : null}
      {searchError ? <Text style={styles.error}>{searchError}</Text> : null}
      {session.lastError ? <Text style={styles.error}>{session.lastError}</Text> : null}
      {suggestions.length > 0 && (
        <View style={styles.suggestionWrap}>
          {suggestions.map((item) => (
            <Pressable
              key={item.userId}
              style={styles.suggestionRow}
              onPress={() => {
                onSelectContact(item.userId, item.displayName);
                setQuery("");
                setSuggestions([]);
              }}
            >
              <Text style={styles.suggestionText}>{toDisplayName(item.displayName, item.userId)}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!loading && query.trim().length > 0 && suggestions.length === 0 && !searchError && (
        <Text style={styles.emptySide}>No users found for "{query.trim()}".</Text>
      )}

      <Text style={styles.recentLabel}>Recent Chats</Text>
      <FlatList
        data={contacts}
        keyExtractor={(item) => item.userId}
        contentContainerStyle={{ paddingBottom: 16 }}
        ListEmptyComponent={<Text style={styles.emptySide}>No chats yet.</Text>}
        renderItem={({ item }) => {
          const selected = item.userId === session.selectedChatUserId;
          const unreadCount = session.unreadByUser[item.userId] ?? 0;
          const nameForInitial = (item.displayName || item.userId).trim();
          const itemInitial = nameForInitial.charAt(0).toUpperCase();
          const showOnlineDot = item.userId !== localUserId;
          return (
            <Pressable style={[styles.contactItem, selected && styles.contactItemSelected]} onPress={() => onSelectContact(item.userId)}>
              <View style={styles.contactAvatarWrap}>
                <View style={styles.contactAvatar}>
                  <Text style={styles.contactAvatarText}>{itemInitial}</Text>
                </View>
                {showOnlineDot && (
                  <View
                    style={[
                      styles.contactPresenceDot,
                      { backgroundColor: item.online ? "#4ade80" : "#94a3b8" },
                    ]}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactName} numberOfLines={1}>
                  {item.userId === localUserId
                    ? `${toDisplayName(item.displayName, item.userId)} (me)`
                    : toDisplayName(item.displayName, item.userId)}
                </Text>
              </View>
              {unreadCount > 0 ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <View style={[styles.chatHeader, { paddingTop: Math.max(insets.top, 0) + 4 }]}>
          {!isDesktopLike && (
            <Pressable onPress={() => setDrawerOpen(true)} style={styles.menuBtn} accessibilityLabel="Open sidebar">
              <Ionicons name="menu" size={24} color="#dbeafe" />
            </Pressable>
          )}
          <View style={styles.headerAvatar}>
            <Text style={styles.headerAvatarText}>
              {(selectedContact ? toDisplayName(selectedContact.displayName, selectedContact.userId) : "C")
                .charAt(0)
                .toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {selectedContact
                ? toDisplayName(selectedContact.displayName, selectedContact.userId)
                : "No user selected"}
            </Text>
            {!session.wsReady && (
              <View style={styles.wsStatusRow}>
                <Ionicons name="cloud-offline" size={11} color="#fde68a" />
                <Text style={styles.wsStatusText}>Reconnecting…</Text>
              </View>
            )}
          </View>
          {!!selectedContact && selectedContact.userId !== localUserId && (
            <View style={styles.callWrap}>
              <Pressable
                style={[styles.callBtn, !call && styles.callBtnDisabled]}
                accessibilityLabel="Start call"
                disabled={!call}
                onPress={() => {
                  if (!call || !selectedContact) return;
                  call.initiateCall(selectedContact.userId, toDisplayName(selectedContact.displayName, selectedContact.userId));
                }}
              >
                <Ionicons name="call" size={16} color="#fff" />
              </Pressable>
              <View style={styles.callPresenceRow}>
                <View
                  style={[
                    styles.callPresenceDot,
                    { backgroundColor: selectedContact.online ? "#4ade80" : "#94a3b8" },
                  ]}
                />
                <Text style={styles.callPresenceText}>
                  {selectedContact.online ? "Online" : "Offline"}
                </Text>
              </View>
            </View>
          )}
          <View style={styles.profileWrap}>
            <Pressable
              onPress={() => setProfileMenuOpen((prev) => !prev)}
              style={styles.profileCircle}
              accessibilityLabel="Profile menu"
            >
              <Text style={styles.profileLetter}>
                {initials}
              </Text>
            </Pressable>
            {profileMenuOpen && (
              <View style={styles.profileMenu}>
                <Pressable
                  style={styles.profileMenuItem}
                  onPress={() => {
                    setProfileMenuOpen(false);
                  }}
                >
                  <Text style={styles.profileMenuText}>Settings</Text>
                </Pressable>
                <Pressable
                  style={styles.profileMenuItem}
                  onPress={() => {
                    setProfileMenuOpen(false);
                    void logout();
                  }}
                >
                  <Text style={[styles.profileMenuText, { color: "#dc2626" }]}>Logout</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>

        {!selectedContact ? (
          <View style={styles.emptyChatWrap}>
            <Ionicons name="chatbubble-ellipses-outline" size={48} color="#cbd5e1" />
            <Text style={styles.emptyChatTitle}>Select a user to start chatting</Text>
          </View>
        ) : (
          <FlatList
            ref={messageListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            onContentSizeChange={() => messageListRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item, index }) => {
              const mine = isLocalMessage(item.senderId);
              const systemMessage = formatSystemMessage(item.text, mine);
              if (systemMessage) {
                const revealed = revealedMessageId === item.id;
                const timeLabel = formatTimestamp(item.timestamp);
                return (
                  <Pressable
                    style={styles.systemMessageOuter}
                    onPress={() => setRevealedMessageId(revealed ? null : item.id)}
                    accessibilityLabel="Show call details"
                  >
                    <View style={styles.systemMessageWrap}>
                      <Text style={styles.systemMessageText}>{systemMessage}</Text>
                    </View>
                    {revealed && timeLabel ? (
                      <Text style={styles.systemMessageTimestamp}>{timeLabel}</Text>
                    ) : null}
                  </Pressable>
                );
              }

              return (
                <MessageBubble
                  message={item}
                  mine={mine}
                  revealed={revealedMessageId === item.id}
                  pickerBelow={index < 2}
                  onToggleReveal={() =>
                    setRevealedMessageId((current) => (current === item.id ? null : item.id))
                  }
                  onReact={(emoji) => handleReaction(item.id, emoji)}
                  onPreviewImage={(url) => setPreviewUrl(url)}
                  onRetry={
                    item.status === "failed" && selectedContact
                      ? () => session.retryMessage(item.id, selectedContact.userId)
                      : undefined
                  }
                />
              );
            }}
          />
        )}

        <View style={[styles.inputRow, { paddingBottom: 10 + Math.max(insets.bottom, 6) }]}>
          <View style={styles.leftActions}>
            <AttachmentMenu
              getToken={getIdToken}
              disabled={!selectedContact || selectedContact.userId === localUserId}
              onUploaded={handleAttachmentUploaded}
            />
            <VoiceRecorder
              disabled={!selectedContact || selectedContact.userId === localUserId}
              onRecorded={handleVoiceRecorded}
            />
          </View>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={selectedContact ? "Message..." : "Select a chat to write..."}
            placeholderTextColor="#94a3b8"
            style={styles.messageInput}
            onSubmitEditing={onSendMessage}
            editable={!!selectedContact}
          />
          <Pressable
            style={[styles.sendBtn, (!selectedContact || !draft.trim()) && styles.sendBtnDisabled]}
            onPress={onSendMessage}
            disabled={!selectedContact || !draft.trim()}
            accessibilityLabel="Send message"
          >
            <Ionicons name="paper-plane" size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {isDesktopLike && renderSidebar(false)}

      {!isDesktopLike && drawerMounted && (
        <Modal visible={drawerMounted} transparent animationType="none" onRequestClose={() => setDrawerOpen(false)}>
          <View style={styles.modalRoot}>
            <Pressable style={styles.backdrop} onPress={() => setDrawerOpen(false)} />
            <Animated.View style={[styles.modalSheet, { transform: [{ translateX: drawerTranslateX }] }]}>
              {renderSidebar(true)}
            </Animated.View>
          </View>
        </Modal>
      )}

      <ImagePreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#ffffff",
  },
  chatArea: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  chatHeader: {
    backgroundColor: "#1d4ed8",
    paddingHorizontal: 12,
    paddingBottom: 8,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    zIndex: 20,
  },
  menuBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  headerTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
  },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 99,
    backgroundColor: "rgba(147,197,253,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: {
    color: "#dbeafe",
    fontWeight: "700",
    fontSize: 20,
  },
  wsStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  wsStatusText: {
    color: "#fde68a",
    fontSize: 11,
    fontWeight: "600",
  },
  callWrap: {
    alignItems: "center",
    marginRight: 14,
  },
  callBtn: {
    width: 34,
    height: 34,
    borderRadius: 99,
    backgroundColor: "#22c55e",
    alignItems: "center",
    justifyContent: "center",
  },
  callBtnDisabled: {
    backgroundColor: "#64748b",
  },
  callPresenceRow: {
    marginTop: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  callPresenceDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
  },
  callPresenceText: {
    color: "#dbeafe",
    fontSize: 11,
    fontWeight: "600",
  },
  emptyChatWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 12,
  },
  emptyChatTitle: {
    color: "#64748b",
    fontSize: 16,
    fontWeight: "600",
  },
  messageList: {
    padding: 12,
    flexGrow: 1,
  },
  systemMessageOuter: {
    alignItems: "center",
    width: "100%",
    marginVertical: 6,
  },
  systemMessageWrap: {
    alignSelf: "center",
    backgroundColor: "#f3f4f6",
    borderColor: "#e5e7eb",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  systemMessageText: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "600",
  },
  systemMessageTimestamp: {
    color: "#9ca3af",
    fontSize: 10,
    marginTop: 4,
  },
  inputRow: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingHorizontal: 8,
    paddingTop: 8,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  leftActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  messageInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#111827",
    backgroundColor: "#ffffff",
  },
  sendBtn: {
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    width: 44,
    height: 44,
    backgroundColor: "#2563eb",
  },
  sendBtnDisabled: {
    backgroundColor: "#93c5fd",
  },
  sidebar: {
    backgroundColor: "#1e3a8a",
    padding: 12,
  },
  sidebarDesktop: {
    width: 320,
  },
  sidebarMobile: {
    width: "100%",
    flex: 1,
  },
  sidebarHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sidebarTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
  },
  closeText: {
    color: "#bfdbfe",
    fontWeight: "700",
  },
  searchRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: "#111827",
  },
  suggestionWrap: {
    backgroundColor: "#fff",
    borderRadius: 8,
    marginBottom: 10,
    overflow: "hidden",
  },
  suggestionRow: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  suggestionText: {
    color: "#111827",
  },
  recentLabel: {
    color: "#bfdbfe",
    fontWeight: "700",
    marginBottom: 6,
    marginTop: 2,
    fontSize: 13,
  },
  contactItem: {
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: 6,
    marginBottom: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  contactItemSelected: {
    backgroundColor: "rgba(59,130,246,0.35)",
  },
  contactName: {
    color: "#ffffff",
    fontWeight: "500",
    fontSize: 15,
  },
  contactAvatarWrap: {
    position: "relative",
  },
  contactAvatar: {
    width: 30,
    height: 30,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  contactAvatarText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 12,
  },
  contactPresenceDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: "#1e3a8a",
  },
  unreadBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
  },
  unreadBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  error: {
    color: "#fecaca",
    marginBottom: 8,
  },
  emptySide: {
    color: "#dbeafe",
    marginTop: 20,
    textAlign: "center",
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-start",
  },
  modalSheet: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "78%",
    maxWidth: 320,
    backgroundColor: "#1e3a8a",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
  },
  profileWrap: {
    position: "relative",
  },
  profileCircle: {
    minWidth: 38,
    height: 38,
    borderRadius: 99,
    backgroundColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  profileLetter: {
    color: "#111827",
    fontWeight: "700",
  },
  profileMenu: {
    position: "absolute",
    top: 42,
    right: 0,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingVertical: 6,
    minWidth: 130,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  profileMenuItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  profileMenuText: {
    color: "#111827",
    fontWeight: "600",
  },
});
