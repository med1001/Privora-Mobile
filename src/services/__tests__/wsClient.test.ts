import { WsClient } from '../wsClient';
jest.mock('../../config/env', () => ({ config: { wsUrl: 'wss://example.test/ws' } }));
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = jest.fn();
  close = jest.fn(() => { this.readyState = 3; });
  constructor(_url: string) { Socket.instances.push(this); }
  opened() { this.readyState = 1; this.onopen?.(); }
  closed(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}
const originalSocket = global.WebSocket;
beforeEach(() => { jest.useFakeTimers(); Socket.instances = []; global.WebSocket = Socket as unknown as typeof WebSocket; });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); global.WebSocket = originalSocket; });

test('reconnect login sends renewed T2 instead of expired T1', async () => {
  const client = new WsClient();
  const tokens = jest.fn().mockResolvedValueOnce('T1').mockResolvedValue('T2');
  client.connect(tokens);
  await jest.advanceTimersByTimeAsync(0);
  Socket.instances[0].opened();
  Socket.instances[0].closed();
  await jest.advanceTimersByTimeAsync(1000);
  Socket.instances[1].opened();
  expect(tokens.mock.calls).toEqual([[false], [true]]);
  expect(Socket.instances[1].send).toHaveBeenCalledWith(JSON.stringify({ type: 'login', token: 'T2' }));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

test('duplicate connects and delayed token results never create concurrent sockets', async () => {
  const token = deferred<string>();
  const provider = jest.fn(() => token.promise);
  const client = new WsClient();
  client.connect(provider);
  client.connect(provider);
  expect(provider).toHaveBeenCalledTimes(1);
  token.resolve('T1');
  await jest.advanceTimersByTimeAsync(0);
  client.connect(provider);
  expect(Socket.instances).toHaveLength(1);
});

test('logout invalidates a pending token and cancels retry timers', async () => {
  const token = deferred<string>();
  const client = new WsClient();
  client.connect(() => token.promise);
  client.disconnect();
  token.resolve('T1');
  await jest.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(0);
  client.connect(async () => 'T2');
  await jest.advanceTimersByTimeAsync(0);
  Socket.instances[0].closed();
  client.disconnect();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled', 'auth/user-not-found', 'auth/id-token-revoked', 'auth/session-changed'])(
  '%s stops retries and signals logout once', async code => {
    const onAuthError = jest.fn();
    const provider = jest.fn().mockRejectedValue({ code });
    const client = new WsClient({ onAuthError });
    client.connect(provider);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(Socket.instances).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  },
);

test('network token failure retries with backoff without logging the user out', async () => {
  const onAuthError = jest.fn();
  const provider = jest.fn().mockRejectedValueOnce({ code: 'auth/network-request-failed' }).mockResolvedValue('T2');
  const client = new WsClient({ onAuthError });
  client.connect(provider);
  await jest.advanceTimersByTimeAsync(999);
  expect(Socket.instances).toHaveLength(0);
  await jest.advanceTimersByTimeAsync(1);
  Socket.instances[0].opened();
  expect(Socket.instances[0].send).toHaveBeenCalledWith(JSON.stringify({ type: 'login', token: 'T2' }));
  expect(onAuthError).not.toHaveBeenCalled();
});

test('1008 stops the session, whereas repeated network closes preserve capped backoff', async () => {
  const onAuthError = jest.fn();
  const provider = jest.fn().mockResolvedValue('token');
  const client = new WsClient({ onAuthError });
  client.connect(provider);
  await jest.advanceTimersByTimeAsync(0);
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const socket = Socket.instances.at(-1)!;
    socket.opened();
    socket.closed();
    const count = Socket.instances.length;
    await jest.advanceTimersByTimeAsync(delay - 1);
    expect(Socket.instances).toHaveLength(count);
    await jest.advanceTimersByTimeAsync(1);
    expect(Socket.instances).toHaveLength(count + 1);
  }
  expect(onAuthError).not.toHaveBeenCalled();
  Socket.instances.at(-1)!.closed(1008);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(onAuthError).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('stale socket events cannot close or authenticate the replacement session', async () => {
  const onAuthError = jest.fn();
  const onClose = jest.fn();
  const client = new WsClient({ onAuthError, onClose });
  client.connect(async () => 'A');
  await jest.advanceTimersByTimeAsync(0);
  const old = Socket.instances[0];
  const lateOpen = old.onopen!;
  const lateClose = old.onclose!;
  const lateError = old.onerror!;
  client.disconnect();
  client.connect(async () => 'B');
  await jest.advanceTimersByTimeAsync(0);
  const next = Socket.instances[1];
  next.opened();
  lateOpen(); lateClose({ code: 1008 }); lateError();
  expect(old.send).not.toHaveBeenCalled();
  expect(next.close).not.toHaveBeenCalled();
  expect(onAuthError).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test('heartbeat remains 30 seconds and a stable connection resets backoff', async () => {
  const client = new WsClient();
  client.connect(async () => 'token');
  await jest.advanceTimersByTimeAsync(0);
  Socket.instances[0].closed();
  await jest.advanceTimersByTimeAsync(1000);
  const current = Socket.instances[1];
  current.opened();
  await jest.advanceTimersByTimeAsync(30_000);
  expect(current.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
  current.closed();
  await jest.advanceTimersByTimeAsync(1000);
  expect(Socket.instances).toHaveLength(3);
  client.disconnect();
  expect(jest.getTimerCount()).toBe(0);
});

test('timed-out token resolution cannot create a late socket after retry', async () => {
  const late = deferred<string>();
  const provider = jest.fn().mockReturnValueOnce(late.promise).mockResolvedValue('T2');
  const client = new WsClient();
  client.connect(provider);
  await jest.advanceTimersByTimeAsync(16_000);
  expect(Socket.instances).toHaveLength(1);
  late.resolve('T1');
  await jest.advanceTimersByTimeAsync(0);
  expect(Socket.instances).toHaveLength(1);
  Socket.instances[0].opened();
  expect(Socket.instances[0].send).toHaveBeenCalledWith(JSON.stringify({ type: 'login', token: 'T2' }));
});

test('a stalled native handshake is closed before a replacement is created', async () => {
  const client = new WsClient();
  client.connect(async () => 'token');
  await jest.advanceTimersByTimeAsync(0);
  const first = Socket.instances[0];
  await jest.advanceTimersByTimeAsync(16_000);
  expect(first.close).toHaveBeenCalledTimes(1);
  expect(Socket.instances).toHaveLength(2);
});


test('synchronous auth close after onerror does not leave a retry or timeout', async () => {
  const onAuthError = jest.fn();
  const client = new WsClient({ onAuthError });
  client.connect(async () => 'token');
  await jest.advanceTimersByTimeAsync(0);
  const socket = Socket.instances[0];
  socket.opened();
  socket.close.mockImplementationOnce(() => socket.closed(1008));
  socket.onerror!();
  expect(onAuthError).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('duplicate open callbacks do not duplicate login or heartbeat', async () => {
  const client = new WsClient();
  client.connect(async () => 'token');
  await jest.advanceTimersByTimeAsync(0);
  const socket = Socket.instances[0];
  socket.opened(); socket.opened();
  expect(socket.send).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(30_000);
  expect(socket.send).toHaveBeenCalledTimes(3);
  client.disconnect();
  expect(jest.getTimerCount()).toBe(0);
});
