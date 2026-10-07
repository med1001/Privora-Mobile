import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, DeviceEventEmitter, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { EventType } from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { AuthProvider, useAuth } from '../../context/AuthContext';
import { startPushSession, stopPushSession, registerPushNotifications, PUSH_TIMEOUT_MS } from '../pushNotifications';
import { registerPushToken, unregisterPushToken } from '../api';
import { cacheIdToken, isCurrentPushRecipient, readCachedIdToken, setPushRecipient } from '../pushIdentity';
import { handleIncomingCallAction, readPendingCallAction, INCOMING_CALL_EVENT } from '../incomingCallActions';
import { displayIncomingCall, handleIncomingCallEvent } from '../incomingCallNotification';
import { handleIncomingCallMessage } from '../incomingCallMessages';
import { useIncomingCallBridge } from '../../hooks/useIncomingCallBridge';
import type { CallState } from '../../hooks/useWebRTCCall';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../api', () => ({ registerPushToken: jest.fn(), unregisterPushToken: jest.fn() }));
jest.mock('../firebase', () => ({ getFirebaseAuth: () => mockAuth }));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(), signInWithEmailAndPassword: jest.fn(), signOut: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(), updateProfile: jest.fn(),
  sendEmailVerification: jest.fn(), sendPasswordResetEmail: jest.fn(),
}));
jest.mock('expo-constants', () => ({ executionEnvironment: 'bare' }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-notifications', () => ({}));
jest.mock('@react-native-firebase/messaging', () => {
  const instance = {
    requestPermission: jest.fn().mockResolvedValue(1),
    getToken: jest.fn().mockResolvedValue('same-device'),
    registerDeviceForRemoteMessages: jest.fn().mockResolvedValue(undefined),
    onMessage: jest.fn().mockReturnValue(jest.fn()),
  };
  return { __esModule: true, default: Object.assign(() => instance, {
    AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2 },
  }) };
});
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    displayNotification: jest.fn().mockResolvedValue('id'),
    cancelNotification: jest.fn().mockResolvedValue(undefined),
    getDisplayedNotifications: jest.fn().mockResolvedValue([]),
    createChannel: jest.fn().mockResolvedValue('incoming_call'),
    onForegroundEvent: jest.fn().mockReturnValue(jest.fn()),
    setNotificationCategories: jest.fn().mockResolvedValue(undefined),
  },
  AndroidCategory: { CALL: 'call' }, AndroidColor: { BLUE: 'blue' },
  AndroidImportance: { HIGH: 4 }, AndroidVisibility: { PUBLIC: 1 },
  EventType: { ACTION_PRESS: 1, PRESS: 2 },
}));

const mockAuth = { currentUser: null as User | null };
const account = (name: string) => ({ uid: name, email: `${name}@test.invalid`, getIdToken: jest.fn().mockResolvedValue(`auth-${name}`) });
const alice = () => account('A');
const bob = () => account('B');
const incoming = (toUserId = 'A@test.invalid') => ({ callId: 'call-1', toUserId, fromUserId: 'C@test.invalid', fromDisplayName: 'Caller' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
async function registered(user = alice()) {
  await startPushSession(user);
  expect(await registerPushNotifications()).toBe(true);
  return user;
}

beforeEach(async () => {
  await stopPushSession();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.mocked(registerPushToken).mockResolvedValue({ ok: true });
  jest.mocked(unregisterPushToken).mockResolvedValue({ ok: true });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.mocked(signOut).mockResolvedValue(undefined);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('registers the same device for B, while repeated registration for A is idempotent', async () => {
  await registered();
  await registerPushNotifications();
  expect(registerPushToken).toHaveBeenCalledTimes(1);
  await startPushSession(bob());
  await registerPushNotifications();
  expect(unregisterPushToken).toHaveBeenCalledWith('auth-A', 'same-device', expect.anything());
  expect(registerPushToken).toHaveBeenLastCalledWith('auth-B', 'same-device', Platform.OS, expect.anything());
  expect(jest.mocked(unregisterPushToken).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(registerPushToken).mock.invocationCallOrder[1]);
});

test('waits for in-flight A registration and unregister before registering B', async () => {
  const response = deferred<{ ok: boolean }>();
  jest.mocked(registerPushToken).mockReturnValueOnce(response.promise);
  await startPushSession(alice());
  const registration = registerPushNotifications();
  await waitFor(() => expect(registerPushToken).toHaveBeenCalledTimes(1));
  const logout = stopPushSession();
  await startPushSession(bob());
  const next = registerPushNotifications();
  expect(registerPushToken).toHaveBeenCalledTimes(1);
  response.resolve({ ok: true });
  expect(await registration).toBe(false);
  await logout;
  expect(await next).toBe(true);
  expect(unregisterPushToken).toHaveBeenCalledWith('auth-A', 'same-device', expect.anything());
  expect(registerPushToken).toHaveBeenLastCalledWith('auth-B', 'same-device', Platform.OS, expect.anything());
});

test('logout cancels a registration still waiting for credentials', async () => {
  const credentials = deferred<string>();
  const user = alice();
  user.getIdToken.mockReturnValueOnce(credentials.promise);
  await startPushSession(user);
  const registration = registerPushNotifications();
  await waitFor(() => expect(user.getIdToken).toHaveBeenCalled());
  const logout = stopPushSession();
  credentials.resolve('auth-A');
  expect(await registration).toBe(false);
  await logout;
  expect(registerPushToken).not.toHaveBeenCalled();
});

test('offline logout clears recipient, pending action, cached credential and visible calls', async () => {
  await registered();
  await handleIncomingCallAction({ kind: 'accept', payload: incoming() });
  jest.mocked(notifee.getDisplayedNotifications).mockResolvedValueOnce([{ trigger: { type: 0, timestamp: 0 }, notification: { id: 'call:call-1', data: { type: 'incoming_call' } } }]);
  jest.mocked(unregisterPushToken).mockRejectedValueOnce(new Error('offline'));
  await stopPushSession();
  expect(await isCurrentPushRecipient('A@test.invalid')).toBe(false);
  expect(await readCachedIdToken('A@test.invalid')).toBeNull();
  expect(await readPendingCallAction()).toBeNull();
  expect(notifee.cancelNotification).toHaveBeenCalledWith('call:call-1');
  await registered(bob());
  expect(await displayIncomingCall(incoming())).toBe(false);
  expect(await displayIncomingCall(incoming('B@test.invalid'))).toBe(true);
});

test('a hanging unregister times out, aborts and allows B to register', async () => {
  await registered();
  jest.useFakeTimers();
  jest.mocked(unregisterPushToken).mockImplementationOnce(() => new Promise(() => {}));
  const logout = stopPushSession();
  await jest.advanceTimersByTimeAsync(PUSH_TIMEOUT_MS + 1);
  await logout;
  expect(jest.mocked(unregisterPushToken).mock.calls[0][2]?.aborted).toBe(true);
  jest.useRealTimers();
  await registered(bob());
});

test('registration failure retries after connectivity is restored', async () => {
  await startPushSession(bob());
  jest.mocked(registerPushToken).mockRejectedValueOnce(new Error('offline'));
  expect(await registerPushNotifications()).toBe(false);
  expect(await registerPushNotifications()).toBe(true);
  expect(registerPushToken).toHaveBeenCalledTimes(2);
});

test('revoked credentials after account deletion still allow local logout, including repeated logout', async () => {
  const user = await registered();
  user.getIdToken.mockRejectedValue(new Error('user deleted'));
  await expect(stopPushSession()).resolves.toBeUndefined();
  await expect(stopPushSession()).resolves.toBeUndefined();
  expect(await isCurrentPushRecipient(user.email)).toBe(false);
  expect(await readCachedIdToken(user.email)).toBeNull();
});

test('logout unregisters a restored session even before initial registration finishes', async () => {
  await startPushSession(alice());
  await stopPushSession();
  expect(unregisterPushToken).toHaveBeenCalledWith('auth-A', 'same-device', expect.anything());
});

test('delayed credential caching from A cannot overwrite B credentials', async () => {
  await registered();
  await registered(bob());
  await cacheIdToken('late-A', 'A@test.invalid');
  expect(await readCachedIdToken('B@test.invalid')).toBe('auth-B');
  expect(await readCachedIdToken('A@test.invalid')).toBeNull();
});

test('recipient filtering rejects missing identity and old notifications/actions after a switch', async () => {
  await registered(bob());
  const emit = jest.spyOn(DeviceEventEmitter, 'emit');
  await handleIncomingCallAction({ kind: 'accept', payload: incoming() });
  expect(emit).not.toHaveBeenCalledWith(INCOMING_CALL_EVENT, expect.anything());
  expect(await displayIncomingCall(incoming())).toBe(false);
  expect(await displayIncomingCall(incoming(''))).toBe(false);
  expect(await handleIncomingCallEvent({ type: EventType.ACTION_PRESS, detail: {
    pressAction: { id: 'accept' }, notification: { data: { ...incoming(), type: 'incoming_call' } },
  } })).toBe(false);
  expect(notifee.displayNotification).not.toHaveBeenCalled();
  expect(await readPendingCallAction()).toBeNull();
});

test('a notification finishing display after logout is immediately cancelled', async () => {
  await registered();
  const displayed = deferred<string>();
  jest.mocked(notifee.displayNotification).mockReturnValueOnce(displayed.promise);
  const showing = displayIncomingCall(incoming());
  await waitFor(() => expect(notifee.displayNotification).toHaveBeenCalled());
  await stopPushSession();
  displayed.resolve('id');
  expect(await showing).toBe(false);
  expect(notifee.cancelNotification).toHaveBeenCalledWith('call:call-1');
});

test('preserves a valid pending Answer when restoring the same account after a cold start', async () => {
  await setPushRecipient('A@test.invalid');
  await handleIncomingCallAction({ kind: 'accept', payload: incoming() });
  await startPushSession(alice());
  expect((await readPendingCallAction())?.payload.callId).toBe('call-1');
});

test('headless identity checks observe a persisted logout and fail closed on storage errors', async () => {
  await registered();
  await AsyncStorage.removeItem('@privora/pushRecipient');
  expect(await isCurrentPushRecipient('A@test.invalid')).toBe(false);
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage unavailable'));
  expect(await isCurrentPushRecipient('A@test.invalid')).toBe(false);
});

async function mountAuthenticated() {
  const user = { ...alice(), emailVerified: true } as unknown as User;
  mockAuth.currentUser = user;
  jest.mocked(onAuthStateChanged).mockImplementation((_auth, callback) => {
    if (typeof callback === 'function') callback(user);
    return jest.fn();
  });
  const hook = renderHook(() => useAuth(), { wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider> });
  await waitFor(() => expect(hook.result.current.user?.uid).toBe('A'));
  await waitFor(() => expect(registerPushToken).toHaveBeenCalled());
  return { ...hook, user };
}

test('AuthProvider unregisters before Firebase signOut and coalesces repeated logout', async () => {
  const { result } = await mountAuthenticated();
  const response = deferred<{ ok: boolean }>();
  jest.mocked(unregisterPushToken).mockReturnValueOnce(response.promise);
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => { first = result.current.logout(); second = result.current.logout(); });
  expect(first).toBe(second);
  await waitFor(() => expect(unregisterPushToken).toHaveBeenCalled());
  expect(signOut).not.toHaveBeenCalled();
  await act(async () => { response.resolve({ ok: true }); await first; });
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(result.current.user).toBeNull();
});

test('AuthProvider waits for logout before logging B in, and retries push on foreground', async () => {
  const appStateListener = jest.spyOn(AppState, 'addEventListener');
  const { result } = await mountAuthenticated();
  const response = deferred<{ ok: boolean }>();
  jest.mocked(unregisterPushToken).mockReturnValueOnce(response.promise);
  jest.mocked(signInWithEmailAndPassword).mockResolvedValue({ user: { ...bob(), emailVerified: true } } as never);
  let logout!: Promise<void>;
  let login!: Promise<void>;
  act(() => { logout = result.current.logout(); login = result.current.login('B@test.invalid', 'test-password'); });
  await waitFor(() => expect(unregisterPushToken).toHaveBeenCalled());
  expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  jest.mocked(registerPushToken).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { response.resolve({ ok: true }); await logout; await login; });
  await waitFor(() => expect(registerPushToken).toHaveBeenCalledTimes(2));
  act(() => { appStateListener.mock.calls[0][1]('active'); });
  await waitFor(() => expect(registerPushToken).toHaveBeenCalledTimes(3));
  expect(registerPushToken).toHaveBeenLastCalledWith('auth-B', 'same-device', Platform.OS, expect.anything());
  expect(result.current.user?.uid).toBe('B');
});

test('AuthProvider completes logout when credentials were revoked by account deletion', async () => {
  const { result, user } = await mountAuthenticated();
  jest.mocked(user.getIdToken).mockRejectedValue(new Error('deleted'));
  await act(async () => { await result.current.logout(); });
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(result.current.user).toBeNull();
});


test('shared headless/foreground handler ignores calls and cancellations for A while B is active', async () => {
  await registered(bob());
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
  await handleIncomingCallAction({ kind: 'accept', payload: incoming('B@test.invalid') });
  await handleIncomingCallMessage({ type: 'incoming_call', ...incoming() });
  await handleIncomingCallMessage({ type: 'cancel_call', callId: 'call-1', toUserId: 'A@test.invalid' });
  await handleIncomingCallMessage({ type: 'incoming_call', ...incoming('') });
  expect(notifee.displayNotification).not.toHaveBeenCalled();
  expect(notifee.cancelNotification).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await readPendingCallAction())?.payload.toUserId).toBe('B@test.invalid');
  await handleIncomingCallMessage({ type: 'incoming_call', ...incoming('B@test.invalid') });
  expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/call-1/ringing'), expect.anything());
  await handleIncomingCallMessage({ type: 'cancel_call', callId: 'call-1', toUserId: 'B@test.invalid' });
  expect(notifee.cancelNotification).toHaveBeenCalledWith('call:call-1');
  expect(await readPendingCallAction()).toBeNull();
});

test('never acknowledges a failed display or a foreground call handled by the overlay', async () => {
  await registered();
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
  jest.mocked(notifee.displayNotification).mockRejectedValueOnce(new Error('native display failed'));
  await handleIncomingCallMessage({ type: 'incoming_call', ...incoming() });
  await handleIncomingCallMessage({ type: 'incoming_call', ...incoming() }, false);
  expect(notifee.displayNotification).toHaveBeenCalledTimes(1);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('notification Decline uses only the matching cached account credential', async () => {
  await registered(bob());
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
  await handleIncomingCallAction({ kind: 'decline', payload: incoming() });
  expect(fetchMock).not.toHaveBeenCalled();
  await handleIncomingCallAction({ kind: 'decline', payload: incoming('B@test.invalid') });
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/call-1/reject'), expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer auth-B' }),
  }));
});

test('AuthProvider rejects an API credential resolving after logout', async () => {
  const { result, user } = await mountAuthenticated();
  const lateToken = deferred<string>();
  jest.mocked(user.getIdToken).mockReturnValueOnce(lateToken.promise);
  const tokenRequest = result.current.getIdToken();
  const rejection = expect(tokenRequest).rejects.toThrow('Authentication session changed');
  await act(async () => { await result.current.logout(); });
  lateToken.resolve('late-A');
  await rejection;
  expect(await readCachedIdToken('A@test.invalid')).toBeNull();
});

test('iOS registration still requests remote messages and uses the iOS backend platform', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  await registered();
  expect(messaging().registerDeviceForRemoteMessages).toHaveBeenCalled();
  expect(registerPushToken).toHaveBeenCalledWith('auth-A', 'same-device', 'ios', expect.anything());
});


test('the bridge restores a cold-start Answer and accepts when the matching offer arrives', async () => {
  await registered();
  await handleIncomingCallAction({ kind: 'accept', payload: incoming() });
  const acceptCall = jest.fn();
  const armAutoAccept = jest.fn();
  const idle: CallState = { status: 'idle', callId: null, peerId: null, peerName: null, isIncoming: false };
  const { rerender } = renderHook(({ state }: { state: CallState }) => useIncomingCallBridge({
    userId: 'A@test.invalid', callState: state, acceptCall, rejectCall: jest.fn(), armAutoAccept,
  }), { initialProps: { state: idle } });
  await waitFor(() => expect(armAutoAccept).toHaveBeenCalledWith('call-1'));
  rerender({ state: { ...idle, callId: 'call-1', status: 'ringing', isIncoming: true } });
  await waitFor(() => expect(acceptCall).toHaveBeenCalledTimes(1));
});

test('the bridge drops A pending auto-accept on a direct account transition to B', async () => {
  await registered();
  await handleIncomingCallAction({ kind: 'accept', payload: incoming() });
  const acceptCall = jest.fn();
  const armAutoAccept = jest.fn();
  const idle: CallState = { status: 'idle', callId: null, peerId: null, peerName: null, isIncoming: false };
  const { rerender } = renderHook(({ userId, state }: { userId: string; state: CallState }) => useIncomingCallBridge({
    userId, callState: state, acceptCall, rejectCall: jest.fn(), armAutoAccept,
  }), { initialProps: { userId: 'A@test.invalid', state: idle } });
  await waitFor(() => expect(armAutoAccept).toHaveBeenCalledWith('call-1'));
  await startPushSession(bob());
  rerender({ userId: 'B@test.invalid', state: { ...idle, callId: 'call-1', status: 'ringing', isIncoming: true } });
  expect(armAutoAccept).toHaveBeenLastCalledWith(null);
  expect(acceptCall).not.toHaveBeenCalled();
});


test('AuthProvider forwards a forced WebSocket token refresh to Firebase', async () => {
  const { result, user } = await mountAuthenticated();
  await result.current.getIdToken(true);
  expect(user.getIdToken).toHaveBeenLastCalledWith(true);
});
