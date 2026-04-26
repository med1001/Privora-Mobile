import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import { LoginScreen } from "../screens/LoginScreen";
import { ChatListScreen } from "../screens/ChatListScreen";
import { useChatSession } from "../hooks/useChatSession";

export type RootStackParamList = {
  Login: undefined;
  ChatList: undefined;
  ChatRoom: { userId: string; displayName: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { user, initializing } = useAuth();
  const session = useChatSession();

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack.Navigator>
      {!user ? (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ title: "Privora Login", headerShown: false }}
        />
      ) : (
        <>
          <Stack.Screen
            name="ChatList"
            options={{
              headerShown: false,
            }}
          >
            {(props) => <ChatListScreen {...props} session={session} />}
          </Stack.Screen>
        </>
      )}
    </Stack.Navigator>
  );
}
