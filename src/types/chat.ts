export type WsIncomingMessage =
  | {
      type: "message";
      from: string;
      to?: string;
      fromDisplayName?: string;
      message: string;
      msg_id?: string;
      timestamp?: string;
      reactions?: Record<string, string>;
    }
  | {
      type: "offline";
      from: string;
      to?: string;
      fromDisplayName?: string;
      message: string;
      msg_id?: string;
      timestamp?: string;
      reactions?: Record<string, string>;
    }
  | {
      type: "history";
      messages: Array<{
        msg_id?: string;
        from: string;
        to: string;
        fromDisplayName?: string;
        message: string;
        timestamp?: string;
        reactions?: Record<string, string>;
      }>;
    }
  | {
      type: "contacts";
      contacts: Array<{
        userId: string;
        displayName: string;
        online?: boolean;
      }>;
    }
  | {
      type: "presence";
      userId: string;
      status: "online" | "offline";
    }
  | {
      type: "reaction";
      msg_id: string;
      from: string;
      to?: string;
      reaction: string;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: string;
      [key: string]: any;
    };

export type ChatMessageStatus = "sent" | "pending" | "failed";

export type ChatMessage = {
  id: string;
  senderId: string;
  recipientId?: string;
  senderName: string;
  text: string;
  timestamp: string;
  reactions?: Record<string, string>;
  status?: ChatMessageStatus;
};

export type ChatContact = {
  userId: string;
  displayName: string;
  online: boolean;
};
