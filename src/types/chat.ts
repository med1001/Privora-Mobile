export type WsIncomingMessage =
  | {
      type: "message";
      from: string;
      fromDisplayName?: string;
      message: string;
      msg_id?: string;
      timestamp?: string;
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
      type: "error";
      message: string;
    }
  | {
      type: string;
      [key: string]: any;
    };

export type ChatMessage = {
  id: string;
  senderId: string;
  recipientId?: string;
  senderName: string;
  text: string;
  timestamp: string;
};

export type ChatContact = {
  userId: string;
  displayName: string;
  online: boolean;
};
