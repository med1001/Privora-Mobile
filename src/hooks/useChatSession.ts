import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { WsClient } from "../services/wsClient";
import { ChatContact, ChatMessage } from "../types/chat";

type MessagesByUser = Record<string, ChatMessage[]>;

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

export function useChatSession() {
  const { getIdToken, user } = useAuth();
  const wsRef = useRef<WsClient | null>(null);

  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [messagesByUser, setMessagesByUser] = useState<MessagesByUser>({});
  const [selectedChatUserId, setSelectedChatUserId] = useState<string | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      wsRef.current?.disconnect();
      wsRef.current = null;
      setWsReady(false);
      setLastError(null);
      return;
    }

    let active = true;
    const ws = new WsClient();
    wsRef.current = ws;

    const unsubscribe = ws.subscribe((payload) => {
      if (!active) return;

      if (payload.type === "message" && payload.from && payload.message) {
        setMessagesByUser((prev) => {
          const next = { ...prev };
          const list = next[payload.from] ?? [];
          next[payload.from] = upsertMessage(list, {
            id: payload.msg_id ?? `${payload.from}-${Date.now()}`,
            senderId: payload.from,
            senderName: payload.fromDisplayName ?? payload.from,
            text: payload.message,
            timestamp: safeIso(payload.timestamp),
          });
          return next;
        });
      }

      if (payload.type === "history" && Array.isArray(payload.messages)) {
        const nextByUser: MessagesByUser = {};
        payload.messages.forEach((entry) => {
          const localUser = user?.email ?? user?.uid ?? "";
          const otherId = entry.from === localUser ? entry.to : entry.from;
          const list = nextByUser[otherId] ?? [];
          nextByUser[otherId] = upsertMessage(list, {
            id: entry.msg_id ?? `${entry.from}-${entry.timestamp ?? Date.now()}`,
            senderId: entry.from,
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
            if (contact.userId === localUserId) return;
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
  }, [getIdToken, user]);

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

  const selectedMessages = useMemo(() => {
    if (!selectedChatUserId) return [];
    return messagesByUser[selectedChatUserId] ?? [];
  }, [messagesByUser, selectedChatUserId]);

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
    selectedChatUserId,
    selectedMessages,
    setSelectedChatUserId,
    sendMessage,
    upsertContacts,
    wsReady,
    lastError,
  };
}
