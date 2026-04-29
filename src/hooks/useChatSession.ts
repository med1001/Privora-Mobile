import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { WsClient } from "../services/wsClient";
import { ChatContact, ChatMessage } from "../types/chat";

type MessagesByUser = Record<string, ChatMessage[]>;
type UnreadByUser = Record<string, number>;

function safeIso(value?: string) {
  if (!value) return new Date().toISOString();
  return value.includes("Z") || value.includes("+") ? value : `${value}Z`;
}

function upsertMessage(list: ChatMessage[], candidate: ChatMessage) {
  const idx = list.findIndex((item) => item.id === candidate.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = { ...next[idx], ...candidate };
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

export function useChatSession() {
  const { getIdToken, logout, user } = useAuth();
  const wsRef = useRef<WsClient | null>(null);
  const selectedChatUserIdRef = useRef<string | null>(null);

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
    });
    wsRef.current = ws;

    const unsubscribe = ws.subscribe((payload) => {
      if (!active) return;

      const localIds = buildLocalIdSet(user);

      if ((payload.type === "message" || payload.type === "offline") && payload.from && payload.message) {
        const payloadTo = (payload as { to?: string }).to;
        const fromLocal = isLocalId(payload.from, localIds);
        const toLocal = isLocalId(payloadTo, localIds);
        const conversationUserId =
          fromLocal && payloadTo && !toLocal
            ? payloadTo
            : payload.from;
        const localUserId = user.email || user.uid || "";
        const trueSelfChat = fromLocal && toLocal;

        if (isLocalId(conversationUserId, localIds) && !trueSelfChat) {
          return;
        }

        setMessagesByUser((prev) => {
          const next = { ...prev };
          const list = next[conversationUserId] ?? [];
          next[conversationUserId] = upsertMessage(list, {
            id: payload.msg_id ?? `${payload.from}-${Date.now()}`,
            senderId: payload.from,
            recipientId: payloadTo ?? localUserId,
            senderName: payload.fromDisplayName ?? payload.from,
            text: payload.message,
            timestamp: safeIso(payload.timestamp),
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

        if (!fromLocal && selectedChatUserIdRef.current !== conversationUserId) {
          setUnreadByUser((prev) => ({
            ...prev,
            [conversationUserId]: (prev[conversationUserId] ?? 0) + 1,
          }));
        }
      }

      if (payload.type === "history" && Array.isArray(payload.messages)) {
        const nextByUser: MessagesByUser = {};
        payload.messages.forEach((entry) => {
          const fromLocal = isLocalId(entry.from, localIds);
          const toLocal = isLocalId(entry.to, localIds);
          let otherId = entry.from;
          if (fromLocal && !toLocal) {
            otherId = entry.to;
          } else if (!fromLocal && toLocal) {
            otherId = entry.from;
          } else if (fromLocal && toLocal) {
            otherId = entry.to;
          }
          const list = nextByUser[otherId] ?? [];
          nextByUser[otherId] = upsertMessage(list, {
            id: entry.msg_id ?? `${entry.from}-${entry.timestamp ?? Date.now()}`,
            senderId: entry.from,
            recipientId: entry.to,
            senderName: entry.fromDisplayName ?? entry.from,
            text: entry.message,
            timestamp: safeIso(entry.timestamp),
          });
        });
        setMessagesByUser((prev) => ({ ...prev, ...nextByUser }));
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
      }

      if (payload.type === "presence" && payload.userId) {
        setContacts((prev) =>
          prev.map((contact) =>
            contact.userId === payload.userId
              ? { ...contact, online: payload.status === "online" }
              : contact,
          ),
        );
      }

      if (payload.type === "error") {
        setLastError(String(payload.message || "WebSocket error"));
      }
    });

    getIdToken()
      .then((token) => {
        if (!active) return;
        ws.connect(token);
        setWsReady(true);
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

  useEffect(() => {
    if (!user) return;
    const localUserId = user.email || user.uid;
    const selfDisplayName = getDisplayName(user.displayName, localUserId);
    setContacts((prev) => {
      const rest = prev.filter((entry) => entry.userId !== localUserId);
      return [{ userId: localUserId, displayName: selfDisplayName, online: true }, ...rest];
    });
    setSelectedChatUserId((prev) => prev ?? localUserId);
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

  const sendMessage = (text: string) => {
    const clean = text.trim();
    if (!clean || !selectedChatUserId || !user) return false;

    const id = `${user.uid}-${Date.now()}`;
    const senderId = user.email || user.uid;
    const senderName = user.displayName || senderId;
    const timestamp = new Date().toISOString();

    setMessagesByUser((prev) => {
      const next = { ...prev };
      const existing = next[selectedChatUserId] ?? [];
      next[selectedChatUserId] = upsertMessage(existing, {
        id,
        senderId,
        recipientId: selectedChatUserId,
        senderName,
        text: clean,
        timestamp,
      });
      return next;
    });

    return wsRef.current?.send({
      type: "message",
      msg_id: id,
      to: selectedChatUserId,
      message: clean,
      fromDisplayName: senderName,
    });
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
    upsertContacts,
    wsReady,
    lastError,
  };
}
