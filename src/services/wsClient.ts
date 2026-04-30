import { config } from "../config/env";
import { WsIncomingMessage } from "../types/chat";

type Listener = (payload: WsIncomingMessage) => void;
type WsClientOptions = {
  onAuthError?: () => void;
  onError?: (message: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export class WsClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private shouldReconnect = false;
  private attempt = 0;
  private token: string | null = null;
  private openedAt = 0;
  private abnormalCloseCount = 0;

  constructor(private readonly options: WsClientOptions = {}) {}

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
    this.clearPing();
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
      this.openedAt = Date.now();
      this.abnormalCloseCount = 0;
      this.send({ type: "login", token: this.token });
      this.send({ type: "signal_session_claim" });
      this.startPing();
      this.options.onOpen?.();
    };

    this.socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as WsIncomingMessage;
        this.listeners.forEach((listener) => listener(parsed));
      } catch {
        // Ignore malformed payloads from network.
      }
    };

    this.socket.onclose = (event) => {
      this.clearPing();
      this.options.onClose?.();
      if (!this.shouldReconnect) return;

      if (event.code === 1008) {
        this.shouldReconnect = false;
        this.options.onError?.("Authentication failed. Please log in again.");
        this.options.onAuthError?.();
        return;
      }

      const connectedForMs = this.openedAt ? Date.now() - this.openedAt : 0;
      const rapidAbnormalClose = event.code === 1006 && connectedForMs > 0 && connectedForMs < 5000;
      this.abnormalCloseCount = rapidAbnormalClose ? this.abnormalCloseCount + 1 : 0;

      if (this.abnormalCloseCount >= 3) {
        this.shouldReconnect = false;
        this.options.onError?.("WebSocket disconnected repeatedly. Please log in again.");
        this.options.onAuthError?.();
        return;
      }

      const timeoutMs = Math.min(1000 * 2 ** this.attempt, 30000);
      this.attempt += 1;
      this.reconnectTimer = setTimeout(() => this.open(), timeoutMs);
    };

    this.socket.onerror = () => {
      this.socket?.close();
    };
  }

  private startPing() {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, 30000);
  }

  private clearPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
