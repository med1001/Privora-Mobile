import { useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { LoginScreen } from "../screens/LoginScreen";
import { ChatListScreen } from "../screens/ChatListScreen";
import { useChatSession } from "../hooks/useChatSession";
import { useWebRTCCall } from "../hooks/useWebRTCCall";
import { CallOverlay } from "../components/CallOverlay";
import type { WsIncomingMessage } from "../types/chat";
import {
  registerPushNotifications,
  unregisterPushNotifications,
} from "../services/pushNotifications";

export type RootStackParamList = {
  Login: undefined;
  ChatList: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { user, initializing, getIdToken } = useAuth();
  const webrtcSignalRef = useRef<(payload: WsIncomingMessage) => void>(() => {});
  const session = useChatSession({
    onWebRtcSignal: (payload) => webrtcSignalRef.current(payload),
  });

  const localUserId = user?.email || user?.uid || "";
  const localDisplayName =
    (user?.displayName && user.displayName.trim()) ||
    (user?.email?.includes("@") ? user.email.split("@")[0].split("+")[0] : "") ||
    localUserId;

  const webrtc = useWebRTCCall({
    localUserId,
    localDisplayName,
    getIdToken,
    sendRaw: session.sendSignaling,
    onCallEnded: (peerId, durationStr, missed, wasOutgoingCaller) => {
      if (!wasOutgoingCaller) return;
      const text = missed ? "__system_call:missed" : `__system_call:ended:${durationStr}`;
      session.sendCallSummaryMessage(peerId, text);
    },
  });

  useEffect(() => {
    webrtcSignalRef.current = webrtc.handleWebRTCSignal;
  }, [webrtc.handleWebRTCSignal]);

  // Register the device for incoming-call push notifications once we know
  // who is logged in. The call is idempotent and silently no-ops on
  // emulators / Expo Go where FCM tokens are unavailable.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const ok = await registerPushNotifications(getIdToken);
      if (cancelled) return;
      if (!ok) {
        console.info("[push] notifications not enabled (no permission or no FCM token)");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getIdToken, user]);

  // On logout, drop the token so the previous user no longer rings on this
  // device. We capture `getIdToken` at unmount time via ref to avoid
  // triggering this effect on every render.
  const logoutCleanupRef = useRef(getIdToken);
  logoutCleanupRef.current = getIdToken;
  useEffect(() => {
    if (user) return undefined;
    return () => {
      void unregisterPushNotifications(logoutCleanupRef.current);
    };
  }, [user]);

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const callProps =
    user != null
      ? {
          callState: webrtc.callState,
          isMuted: webrtc.isMuted,
          isSpeaker: webrtc.isSpeaker,
          toggleMute: webrtc.toggleMute,
          toggleSpeaker: webrtc.toggleSpeaker,
          initiateCall: webrtc.initiateCall,
          acceptCall: webrtc.acceptCall,
          rejectCall: webrtc.rejectCall,
          endCall: webrtc.endCall,
        }
      : undefined;

  return (
    <>
      <Stack.Navigator>
        {!user ? (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ title: "Privora Login", headerShown: false }}
          />
        ) : (
          <Stack.Screen
            name="ChatList"
            options={{
              headerShown: false,
            }}
          >
            {(props) => <ChatListScreen {...props} session={session} call={callProps} />}
          </Stack.Screen>
        )}
      </Stack.Navigator>
      {callProps ? (
        <CallOverlay
          callState={callProps.callState}
          isMuted={callProps.isMuted}
          isSpeaker={callProps.isSpeaker}
          onAccept={callProps.acceptCall}
          onReject={callProps.rejectCall}
          onHangup={callProps.endCall}
          onToggleMute={callProps.toggleMute}
          onToggleSpeaker={callProps.toggleSpeaker}
        />
      ) : null}
    </>
  );
}
