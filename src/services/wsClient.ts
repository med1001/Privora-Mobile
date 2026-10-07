import { config } from "../config/env";
import { WsIncomingMessage } from "../types/chat";

type Listener = (payload: WsIncomingMessage) => void;
type TokenProvider = (forceRefresh: boolean) => Promise<string>;
type WsClientOptions = {
  onAuthError?: () => void;
  onError?: (message: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

const AUTH_ERRORS = new Set([
  "auth/user-token-expired", "auth/invalid-user-token", "auth/user-disabled",
  "auth/user-not-found", "auth/id-token-revoked", "auth/session-changed",
]);
const CONNECT_TIMEOUT_MS = 15_000;

export class WsClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private shouldReconnect = false;
  private attempt = 0;
  private getToken: TokenProvider | null = null;
  private generation = 0;
  private opening = false;
  private hasAttempted = false;

  constructor(private readonly options: WsClientOptions = {}) {}

  connect(getToken: TokenProvider) {
    if (this.shouldReconnect) return;
    this.getToken = getToken;
    this.shouldReconnect = true;
    this.attempt = 0;
    this.hasAttempted = false;
    void this.open();
  }

  disconnect() {
    this.shouldReconnect = false;
    this.getToken = null;
    this.generation += 1;
    this.opening = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearTransport();
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

  private current(generation: number) {
    return this.shouldReconnect && this.generation === generation;
  }

  private async open() {
    if (!this.shouldReconnect || !this.getToken || this.opening || this.socket) return;
    this.opening = true;
    const generation = ++this.generation;
    const forceRefresh = this.hasAttempted;
    this.hasAttempted = true;
    this.connectTimer = setTimeout(() => this.failed(generation, false), CONNECT_TIMEOUT_MS);
    try {
      const token = await this.getToken(forceRefresh);
      if (!this.current(generation)) return;
      if (!token) { this.failed(generation, true); return; }
      const socket = new WebSocket(config.wsUrl);
      this.socket = socket;
      let openedAt: number | null = null;
      const currentSocket = () => this.current(generation) && this.socket === socket;

      socket.onopen = () => {
        if (!currentSocket() || openedAt !== null) return;
        if (this.connectTimer) clearTimeout(this.connectTimer);
        this.connectTimer = null;
        this.opening = false;
        openedAt = Date.now();
        try {
          socket.send(JSON.stringify({ type: "login", token }));
          socket.send(JSON.stringify({ type: "signal_session_claim" }));
        } catch { this.failed(generation, false); return; }
        this.startPing();
        this.options.onOpen?.();
      };
      socket.onmessage = (event) => {
        if (!currentSocket()) return;
        try {
          const parsed = JSON.parse(event.data) as WsIncomingMessage;
          this.listeners.forEach(listener => listener(parsed));
        } catch { /* Ignore malformed payloads. */ }
      };
      socket.onclose = (event) => {
        if (!currentSocket()) return;
        // A brief open/close loop is still a network failure, not proof of revocation.
        if (openedAt !== null && Date.now() - openedAt >= 30_000) this.attempt = 0;
        this.failed(generation, event.code === 1008);
      };
      // Wait for onclose to preserve its authentication code. The timeout also
      // handles transports which fail without ever producing an open/close.
      socket.onerror = () => {
        if (!currentSocket()) return;
        socket.close();
        if (!currentSocket()) return;
        if (!this.connectTimer) {
          this.connectTimer = setTimeout(() => this.failed(generation, false), CONNECT_TIMEOUT_MS);
        }
      };
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      this.failed(generation, !!code && AUTH_ERRORS.has(code));
    }
  }

  private failed(generation: number, authentication: boolean) {
    if (!this.current(generation)) return;
    this.generation += 1;
    this.opening = false;
    this.clearTransport();
    if (authentication) {
      this.disconnect();
      this.options.onClose?.();
      this.options.onError?.("Authentication failed. Please log in again.");
      this.options.onAuthError?.();
      return;
    }
    this.options.onClose?.();
    this.options.onError?.("Connection unavailable. Retrying…");
    if (!this.shouldReconnect) return;
    const delay = Math.min(1000 * 2 ** this.attempt, 30_000);
    this.attempt = Math.min(this.attempt + 1, 5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }

  private startPing() {
    this.pingTimer = setInterval(() => {
      try { this.send({ type: "ping" }); }
      catch { this.failed(this.generation, false); }
    }, 30_000);
  }

  private clearTransport() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.connectTimer = null;
    this.pingTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      try { socket.close(); } catch { /* Already closed native transport. */ }
    }
  }
}
