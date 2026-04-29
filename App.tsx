import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Font from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { AuthProvider } from "./src/context/AuthContext";
import { RootNavigator } from "./src/navigation/RootNavigator";

export default function App() {
  useEffect(() => {
    Font.loadAsync({ ...Ionicons.font })
      .then(() => {
        console.log("[fonts] Ionicons loaded");
      })
      .catch((err) => {
        console.warn("[fonts] Ionicons load failed:", err?.message || err);
      });
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <StatusBar style="dark" />
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
