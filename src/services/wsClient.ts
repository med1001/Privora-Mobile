import { config } from "../config/env";
import { WsIncomingMessage } from "../types/chat";

type Listener = (payload: WsIncomingMessage) => void;

export class WsClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private shouldReconnect = false;
  private attempt = 0;
  private token: string | null = null;

  connect(token: string) {
    this.token = token;
    this.shouldReconnect = true;
    this.open();
  }

  disconnect() {
    this.shouldReconnect = false;
    this.token = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  send(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private open() {
    if (!this.token) return;
    this.socket = new WebSocket(config.wsUrl);

    this.socket.onopen = () => {
      this.attempt = 0;
      this.send({ type: "login", token: this.token });
    };

    this.socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as WsIncomingMessage;
        this.listeners.forEach((listener) => listener(parsed));
      } catch {
        // Ignore malformed payloads from network.
      }
    };

    this.socket.onclose = () => {
      if (!this.shouldReconnect) return;
      const timeoutMs = Math.min(1000 * 2 ** this.attempt, 30000);
      this.attempt += 1;
      this.reconnectTimer = setTimeout(() => this.open(), timeoutMs);
    };

    this.socket.onerror = () => {
      this.socket?.close();
    };
  }
}
