import { useEffect, useMemo, useRef, useState } from "react";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import { useAuth } from "../context/AuthContext";
import { WsClient } from "../services/wsClient";
import {
  ChatContact,
  ChatMessage,
  ChatMessageStatus,
  WsIncomingMessage,
} from "../types/chat";

type MessagesByUser = Record<string, ChatMessage[]>;
type UnreadByUser = Record<string, number>;
type UseChatSessionOptions = {
  onWebRtcSignal?: (payload: WsIncomingMessage) => void;
};

const CALL_SIGNAL_TYPES = new Set([
  "call_offer",
  "call_answer",
  "ice_candidate",
  "call_reject",
  "call_end",
  "call_ring",
  "call_ring_offline",
  "call_accepting",
  "call_connected",
]);

const NOTIFICATION_SOUND = require("../../assets/sounds/messenger.mp3");

function safeIso(value?: string) {
  if (!value) return new Date().toISOString();
  return value.includes("Z") || value.includes("+") ? value : `${value}Z`;
}

function upsertMessage(list: ChatMessage[], candidate: ChatMessage) {
  const idx = list.findIndex((item) => item.id === candidate.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = {
      ...next[idx],
      ...candidate,
      reactions: candidate.reactions ?? next[idx].reactions,
    };
    return next;
  }
  return [...list, candidate];
}

function getDisplayName(rawDisplayName: string | null | undefined, userId: string) {
  const value = (rawDisplayName || "").trim();
  if (value) return value;
  if (userId.includes("@")) {
    const localPart = userId.split("@")[0];
    return localPart.split("+")[0] || userId;
  }
  return userId;
}

function normalizeId(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function buildLocalIdSet(user: { email?: string | null; uid?: string | null } | null | undefined) {
  const ids = new Set<string>();
  if (user?.email) ids.add(normalizeId(user.email));
  if (user?.uid) ids.add(normalizeId(user.uid));
  return ids;
}

function isLocalId(value: string | null | undefined, localIds: Set<string>) {
  return !!value && localIds.has(normalizeId(value));
}

export function useChatSession(options?: UseChatSessionOptions) {
  const { getIdToken, logout, user } = useAuth();
  const wsRef = useRef<WsClient | null>(null);
  const selectedChatUserIdRef = useRef<string | null>(null);
  const webRtcSignalRef = useRef<((payload: WsIncomingMessage) => void) | undefined>(options?.onWebRtcSignal);
  const notificationSoundRef = useRef<Audio.Sound | null>(null);

  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [messagesByUser, setMessagesByUser] = useState<MessagesByUser>({});
  const [unreadByUser, setUnreadByUser] = useState<UnreadByUser>({});
  const [selectedChatUserId, setSelectedChatUserId] = useState<string | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    selectedChatUserIdRef.current = selectedChatUserId;
  }, [selectedChatUserId]);

  useEffect(() => {
    webRtcSignalRef.current = options?.onWebRtcSignal;
  }, [options?.onWebRtcSignal]);

  // Pre-load the message notification sound once and keep it ready in memory.
  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
          interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
          playThroughEarpieceAndroid: false,
        });
      } catch {
        // Audio mode is best-effort; failure to set should not block chat.
      }
      try {
        const { sound } = await Audio.Sound.createAsync(NOTIFICATION_SOUND, { volume: 0.8 });
        if (cancelled) {
          sound.unloadAsync().catch(() => {});
          return;
        }
        notificationSoundRef.current = sound;
      } catch {
        // Notification sound is non-critical.
      }
    };
    void setup();
    return () => {
      cancelled = true;
      const existing = notificationSoundRef.current;
      notificationSoundRef.current = null;
      if (existing) {
        existing.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const playNotificationSound = async () => {
    const sound = notificationSoundRef.current;
    if (!sound) return;
    try {
      await sound.setPositionAsync(0);
      await sound.playAsync();
    } catch {
      // Notification sound is non-critical.
    }
  };

  useEffect(() => {
    if (!user) {
      wsRef.current?.disconnect();
      wsRef.current = null;
      setWsReady(false);
      setLastError(null);
      return;
    }

    let active = true;
    const ws = new WsClient({
      onAuthError: () => {
        void logout();
      },
      onError: (message) => setLastError(message),
      onOpen: () => {
        if (active) setWsReady(true);
      },
      onClose: () => {
        if (active) setWsReady(false);
      },
    });
    wsRef.current = ws;

    const unsubscribe = ws.subscribe((payload) => {
      if (!active) return;

      const localIds = buildLocalIdSet(user);

      if (CALL_SIGNAL_TYPES.has(payload.type)) {
        webRtcSignalRef.current?.(payload);
        return;
      }

      if ((payload.type === "message" || payload.type === "offline") && payload.from && payload.message) {
        const payloadTo = (payload as { to?: string }).to;
        const fromLocal = isLocalId(payload.from, localIds);
        const toLocal = isLocalId(payloadTo, localIds);
        const conversationUserId =
          fromLocal && payloadTo && !toLocal ? payloadTo : payload.from;
        const localUserId = user.email || user.uid || "";
        const trueSelfChat = fromLocal && toLocal;

        if (isLocalId(conversationUserId, localIds) && !trueSelfChat) {
          return;
        }

        const incomingId = payload.msg_id ?? `${payload.from}-${Date.now()}`;

        setMessagesByUser((prev) => {
          const next = { ...prev };
          const list = next[conversationUserId] ?? [];
          next[conversationUserId] = upsertMessage(list, {
            id: incomingId,
            senderId: payload.from,
            recipientId: payloadTo ?? localUserId,
            senderName: payload.fromDisplayName ?? payload.from,
            text: payload.message,
            timestamp: safeIso(payload.timestamp),
            reactions: (payload as { reactions?: Record<string, string> }).reactions,
            status: "sent",
          });
          return next;
        });

        setContacts((prev) => {
          const map = new Map(prev.map((item) => [item.userId, item]));
          const existing = map.get(conversationUserId);
          map.set(conversationUserId, {
            userId: conversationUserId,
            displayName: fromLocal
              ? existing?.displayName || getDisplayName(undefined, conversationUserId)
              : getDisplayName(payload.fromDisplayName, conversationUserId),
            online: existing?.online ?? false,
          });
          return Array.from(map.values());
        });

        // Increment unread + play notification sound only when message comes from
        // someone else AND the user is currently looking at a different conversation.
        if (!fromLocal && selectedChatUserIdRef.current !== conversationUserId) {
          setUnreadByUser((prev) => ({
            ...prev,
            [conversationUserId]: (prev[conversationUserId] ?? 0) + 1,
          }));
          if (payload.type === "message") {
            void playNotificationSound();
          }
        }
        return;
      }

      if (payload.type === "reaction" && payload.msg_id && payload.from && payload.reaction) {
        const reactionFrom = payload.from;
        const reactionTo = (payload as { to?: string }).to;
        // The message belongs to a conversation between sender and recipient.
        // Pick the "other" id as conversation key (mirror of the chat layout).
        const fromLocal = isLocalId(reactionFrom, localIds);
        const toLocal = isLocalId(reactionTo, localIds);
        const conversationUserId =
          fromLocal && reactionTo && !toLocal
            ? reactionTo
            : !fromLocal
            ? reactionFrom
            : reactionTo || reactionFrom;

        setMessagesByUser((prev) => {
          const next = { ...prev };
          // Reactions can target a message stored under either side of the
          // pair; scan all conversations as a safety net.
          const candidateKeys = [conversationUserId, reactionFrom, reactionTo].filter(
            (value): value is string => !!value,
          );
          let updated = false;
          for (const key of candidateKeys) {
            const list = next[key];
            if (!list) continue;
            const idx = list.findIndex((entry) => entry.id === payload.msg_id);
            if (idx < 0) continue;
            const target = list[idx];
            const reactions = { ...(target.reactions ?? {}) };
            reactions[reactionFrom] = payload.reaction;
            const nextList = [...list];
            nextList[idx] = { ...target, reactions };
            next[key] = nextList;
            updated = true;
            break;
          }
          return updated ? next : prev;
        });
        return;
      }

      if (payload.type === "history" && Array.isArray(payload.messages)) {
        type HistoryEntry = {
          msg_id?: string;
          from: string;
          to: string;
          fromDisplayName?: string;
          message: string;
          timestamp?: string;
          reactions?: Record<string, string>;
        };
        const historyMessages = payload.messages as HistoryEntry[];
        setMessagesByUser((prev) => {
          const next: MessagesByUser = { ...prev };
          historyMessages.forEach((entry) => {
            const fromLocal = isLocalId(entry.from, localIds);
            const toLocal = isLocalId(entry.to, localIds);
            let otherId = entry.from;
            if (fromLocal && !toLocal) otherId = entry.to;
            else if (!fromLocal && toLocal) otherId = entry.from;
            else if (fromLocal && toLocal) otherId = entry.to;
            const list = next[otherId] ?? [];
            next[otherId] = upsertMessage(list, {
              id: entry.msg_id ?? `${entry.from}-${entry.timestamp ?? Date.now()}`,
              senderId: entry.from,
              recipientId: entry.to,
              senderName: entry.fromDisplayName ?? entry.from,
              text: entry.message,
              timestamp: safeIso(entry.timestamp),
              reactions: entry.reactions,
              status: "sent",
            });
          });
          const touchedKeys = new Set<string>(
            historyMessages.map((m) => {
              const fromLocal = isLocalId(m.from, localIds);
              const toLocal = isLocalId(m.to, localIds);
              if (fromLocal && !toLocal) return m.to;
              if (!fromLocal && toLocal) return m.from;
              return m.to;
            }),
          );
          touchedKeys.forEach((key) => {
            if (!key) return;
            const list = next[key];
            if (!list) return;
            next[key] = [...list].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
            );
          });
          return next;
        });
        return;
      }

      if (payload.type === "contacts" && Array.isArray(payload.contacts)) {
        setContacts((prev) => {
          const map = new Map<string, ChatContact>();
          const localUserId = user?.email || user?.uid || "";
          const selfDisplayName = getDisplayName(user?.displayName, localUserId);

          if (localUserId) {
            map.set(localUserId, {
              userId: localUserId,
              displayName: selfDisplayName,
              online: true,
            });
          }

          prev.forEach((entry) => {
            if (entry.userId !== localUserId) {
              map.set(entry.userId, entry);
            }
          });

          payload.contacts.forEach((contact: { userId: string; displayName?: string; online?: boolean }) => {
            if (isLocalId(contact.userId, localIds)) return;
            map.set(contact.userId, {
              userId: contact.userId,
              displayName: contact.displayName || contact.userId,
              online: Boolean(contact.online),
            });
          });

          return Array.from(map.values());
        });
        return;
      }

      if (payload.type === "presence" && payload.userId) {
        setContacts((prev) =>
          prev.map((contact) =>
            contact.userId === payload.userId
              ? { ...contact, online: payload.status === "online" }
              : contact,
          ),
        );
        return;
      }

      if (payload.type === "error") {
        setLastError(String(payload.message || "WebSocket error"));
      }
    });

    getIdToken()
      .then((token) => {
        if (!active) return;
        ws.connect(token);
        setLastError(null);
      })
      .catch((err) => setLastError(String(err)));

    return () => {
      active = false;
      unsubscribe();
      ws.disconnect();
      wsRef.current = null;
      setWsReady(false);
    };
  }, [getIdToken, logout, user]);

  // Always make sure the local user appears in the contact list (top entry),
  // but never auto-select a chat: web shows an empty placeholder until the
  // user picks a conversation.
  useEffect(() => {
    if (!user) return;
    const localUserId = user.email || user.uid;
    const selfDisplayName = getDisplayName(user.displayName, localUserId);
    setContacts((prev) => {
      const rest = prev.filter((entry) => entry.userId !== localUserId);
      return [{ userId: localUserId, displayName: selfDisplayName, online: true }, ...rest];
    });
  }, [user]);

  const selectChatUserId = (userId: string | null) => {
    setSelectedChatUserId(userId);
    if (userId) {
      setUnreadByUser((prev) => {
        if (!prev[userId]) return prev;
        const { [userId]: _ignored, ...rest } = prev;
        return rest;
      });
    }
  };

  const selectedMessages = useMemo(() => {
    if (!selectedChatUserId) return [];
    const list = messagesByUser[selectedChatUserId] ?? [];
    const localIds = buildLocalIdSet(user);
    if (!isLocalId(selectedChatUserId, localIds)) return list;

    return list.filter((message) => {
      const senderLocal = isLocalId(message.senderId, localIds);
      const recipientLocal = isLocalId(message.recipientId, localIds);
      return senderLocal && (recipientLocal || !message.recipientId);
    });
  }, [messagesByUser, selectedChatUserId, user]);

  const sendRawMessage = (text: string, peerOverride?: string) => {
    const clean = text;
    const peerId = peerOverride ?? selectedChatUserId;
    if (!clean || !peerId || !user) return false;

    const id = `${user.uid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const senderId = user.email || user.uid;
    const senderName = user.displayName || senderId;
    const timestamp = new Date().toISOString();

    const ok = wsRef.current?.send({
      type: "message",
      msg_id: id,
      to: peerId,
      message: clean,
      fromDisplayName: senderName,
    }) ?? false;

    setMessagesByUser((prev) => {
      const next = { ...prev };
      const existing = next[peerId] ?? [];
      next[peerId] = upsertMessage(existing, {
        id,
        senderId,
        recipientId: peerId,
        senderName,
        text: clean,
        timestamp,
        status: ok ? "sent" : "failed",
      });
      return next;
    });

    return ok;
  };

  const sendMessage = (text: string) => {
    const clean = text.trim();
    if (!clean) return false;
    return sendRawMessage(clean);
  };

  const sendReaction = (msgId: string, peerId: string, reaction: string) => {
    if (!user || !msgId || !peerId) return false;
    const ok = wsRef.current?.send({
      type: "reaction",
      msg_id: msgId,
      to: peerId,
      reaction,
    }) ?? false;
    if (!ok) return false;
    const localUserId = user.email || user.uid;
    setMessagesByUser((prev) => {
      const next = { ...prev };
      const list = next[peerId];
      if (!list) return prev;
      const idx = list.findIndex((entry) => entry.id === msgId);
      if (idx < 0) return prev;
      const reactions = { ...(list[idx].reactions ?? {}) };
      reactions[localUserId] = reaction;
      const nextList = [...list];
      nextList[idx] = { ...list[idx], reactions };
      next[peerId] = nextList;
      return next;
    });
    return true;
  };

  const retryMessage = (msgId: string, peerId: string) => {
    if (!user) return false;
    const list = messagesByUser[peerId];
    if (!list) return false;
    const target = list.find((entry) => entry.id === msgId);
    if (!target || target.status !== "failed") return false;
    const senderName = user.displayName || user.email || user.uid;
    const ok = wsRef.current?.send({
      type: "message",
      msg_id: msgId,
      to: peerId,
      message: target.text,
      fromDisplayName: senderName,
    }) ?? false;
    if (!ok) return false;
    setMessagesByUser((prev) => {
      const next = { ...prev };
      const existing = next[peerId];
      if (!existing) return prev;
      next[peerId] = existing.map((entry) =>
        entry.id === msgId ? { ...entry, status: "sent" as ChatMessageStatus } : entry,
      );
      return next;
    });
    return true;
  };

  const sendSignaling = (payload: Record<string, unknown>) => {
    return wsRef.current?.send(payload) ?? false;
  };

  const sendCallSummaryMessage = (peerId: string, text: string) => {
    if (!peerId || !user) return false;
    return sendRawMessage(text, peerId);
  };

  const upsertContacts = (entries: ChatContact[]) => {
    setContacts((prev) => {
      const map = new Map(prev.map((item) => [item.userId, item]));
      entries.forEach((entry) => {
        const prior = map.get(entry.userId);
        map.set(entry.userId, {
          userId: entry.userId,
          displayName: entry.displayName || prior?.displayName || entry.userId,
          online: entry.online ?? prior?.online ?? false,
        });
      });
      return Array.from(map.values());
    });
  };

  return {
    contacts,
    unreadByUser,
    selectedChatUserId,
    selectedMessages,
    setSelectedChatUserId: selectChatUserId,
    sendMessage,
    sendRawMessage,
    sendReaction,
    retryMessage,
    sendSignaling,
    sendCallSummaryMessage,
    upsertContacts,
    wsReady,
    lastError,
  };
}
