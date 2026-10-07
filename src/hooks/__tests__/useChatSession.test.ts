import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAuth } from '../../context/AuthContext';
import { WsClient } from '../../services/wsClient';
import { useChatSession } from '../useChatSession';
import type { WsIncomingMessage } from '../../types/chat';

// Mock external boundaries, never the hook or its message transformations.
jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../services/wsClient', () => ({ WsClient: jest.fn() }));
jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    Sound: {
      createAsync: jest.fn().mockResolvedValue({ sound: {
        setPositionAsync: jest.fn().mockResolvedValue(undefined),
        playAsync: jest.fn().mockResolvedValue(undefined),
        unloadAsync: jest.fn().mockResolvedValue(undefined),
      } }),
    },
  },
  InterruptionModeAndroid: { DoNotMix: 1 },
  InterruptionModeIOS: { DoNotMix: 1 },
}));

type Auth = ReturnType<typeof useAuth>;
type SocketOptions = ConstructorParameters<typeof WsClient>[0];
type SocketDouble = {
  emit: (payload: WsIncomingMessage) => void;
  connect: jest.Mock;
  disconnect: jest.Mock;
  unsubscribe: jest.Mock;
  options: SocketOptions;
};

const alice = { uid: 'alice-uid', email: 'alice@example.test', displayName: 'Alice' } as Auth['user'];
const bob = { uid: 'bob-uid', email: 'bob@example.test', displayName: 'Bob' } as Auth['user'];
const peer = 'peer@example.test';
const incoming = {
  type: 'message' as const,
  msg_id: 'message-1',
  from: peer,
  to: 'alice@example.test',
  message: 'Bonjour',
  timestamp: '2026-10-06T10:00:00Z',
};
let auth: Auth;
let sockets: SocketDouble[];

beforeEach(() => {
  sockets = [];
  auth = {
    user: alice, initializing: false,
    getIdToken: jest.fn().mockResolvedValue('test-token'),
    logout: jest.fn().mockResolvedValue(undefined),
    login: jest.fn(), register: jest.fn(), resetPassword: jest.fn(),
  };
  jest.mocked(useAuth).mockImplementation(() => auth);
  jest.mocked(WsClient).mockImplementation((options) => {
    const socket: SocketDouble = {
      options, emit: () => { throw new Error('No subscriber'); },
      connect: jest.fn(), disconnect: jest.fn(), unsubscribe: jest.fn(),
    };
    sockets.push(socket);
    return {
      connect: socket.connect, disconnect: socket.disconnect,
      send: jest.fn().mockReturnValue(true),
      subscribe: jest.fn((listener) => {
        // Retain callback to simulate an event already queued before cleanup.
        socket.emit = listener;
        return socket.unsubscribe;
      }),
    } as unknown as WsClient;
  });
});

async function mountSession() {
  const hook = renderHook(() => useChatSession());
  await waitFor(() => expect(sockets[0].connect).toHaveBeenCalledWith(auth.getIdToken));
  return hook;
}

test('receives a message, exposes its contact and clears unread when selected', async () => {
  const { result } = await mountSession();
  act(() => sockets[0].emit(incoming));
  expect(result.current.unreadByUser[peer]).toBe(1);
  expect(result.current.contacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ userId: peer }),
  ]));
  act(() => result.current.setSelectedChatUserId(peer));
  expect(result.current.unreadByUser[peer]).toBeUndefined();
  expect(result.current.selectedMessages).toEqual([
    expect.objectContaining({ id: 'message-1', text: 'Bonjour', senderId: peer, status: 'sent' }),
  ]);
});

test.each(['message', 'offline'] as const)('%s replay and history merge by msg_id without duplicate messages', async (type) => {
  const { result } = await mountSession();
  act(() => result.current.setSelectedChatUserId(peer));
  act(() => {
    sockets[0].emit(incoming);
    sockets[0].emit({ ...incoming, type, message: 'Updated' });
    sockets[0].emit({ type: 'history', messages: [
      { ...incoming, message: 'History version', reactions: { [peer]: '👍' } },
      { ...incoming, msg_id: 'older', message: 'Earlier', timestamp: '2026-10-06T09:00:00Z' },
      { ...incoming, message: 'History version', reactions: { [peer]: '👍' } },
    ] });
  });
  expect(result.current.selectedMessages.map(({ id }) => id)).toEqual(['older', 'message-1']);
  expect(result.current.selectedMessages[1]).toMatchObject({
    text: 'History version', reactions: { [peer]: '👍' },
  });
});

test('keeps conversations separate when history contains incoming and outgoing messages', async () => {
  const { result } = await mountSession();
  act(() => sockets[0].emit({ type: 'history', messages: [
    incoming,
    { ...incoming, msg_id: 'outgoing', from: 'alice-uid', to: 'other@example.test', message: 'Other chat' },
  ] }));
  act(() => result.current.setSelectedChatUserId(peer));
  expect(result.current.selectedMessages.map(({ id }) => id)).toEqual(['message-1']);
  act(() => result.current.setSelectedChatUserId('other@example.test'));
  expect(result.current.selectedMessages.map(({ id }) => id)).toEqual(['outgoing']);
});

test('logout clears state and a subsequent account cannot receive events from the old session', async () => {
  const { result, rerender } = await mountSession();
  const oldSocket = sockets[0];
  act(() => {
    oldSocket.options?.onOpen?.();
    oldSocket.emit(incoming);
    oldSocket.emit({ type: 'error', message: 'Old error' });
  });
  act(() => result.current.setSelectedChatUserId(peer));
  act(() => oldSocket.emit({ ...incoming, from: 'unread@example.test', msg_id: 'unread' }));
  expect(result.current.wsReady).toBe(true);
  expect(result.current.selectedMessages).toHaveLength(1);
  expect(result.current.lastError).toBe('Old error');
  expect(result.current.unreadByUser['unread@example.test']).toBe(1);

  auth = { ...auth, user: null };
  rerender({});
  expect(oldSocket.unsubscribe).toHaveBeenCalledTimes(1);
  expect(oldSocket.disconnect).toHaveBeenCalledTimes(1);
  expect(result.current).toMatchObject({
    contacts: [], unreadByUser: {}, selectedChatUserId: null,
    selectedMessages: [], wsReady: false, lastError: null,
  });

  auth = { ...auth, user: bob };
  rerender({});
  await waitFor(() => expect(sockets[1].connect).toHaveBeenCalledWith(auth.getIdToken));
  act(() => {
    oldSocket.emit({ ...incoming, msg_id: 'late-old-message' });
    oldSocket.options?.onOpen?.();
  });
  act(() => result.current.setSelectedChatUserId(peer));
  expect(result.current.selectedMessages).toEqual([]);
  expect(result.current.unreadByUser).toEqual({});
  expect(result.current.wsReady).toBe(false);
  expect(result.current.contacts.map(({ userId }) => userId)).toEqual(['bob@example.test']);
  act(() => sockets[1].emit({ ...incoming, to: 'bob@example.test', msg_id: 'bob-message' }));
  expect(result.current.selectedMessages.map(({ id }) => id)).toEqual(['bob-message']);
});


test('only the current WebSocket can trigger logout on authentication failure', async () => {
  const { rerender } = await mountSession();
  const old = sockets[0];
  auth = { ...auth, user: bob };
  rerender({});
  act(() => { old.options?.onAuthError?.(); old.options?.onError?.('stale failure'); });
  expect(auth.logout).not.toHaveBeenCalled();
  act(() => sockets[1].options?.onAuthError?.());
  expect(auth.logout).toHaveBeenCalledTimes(1);
});
