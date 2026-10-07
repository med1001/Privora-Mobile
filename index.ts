import { registerRootComponent } from "expo";
import notifee, { EventType, type Event } from "@notifee/react-native";
import messaging from "@react-native-firebase/messaging";
import { handleIncomingCallEvent } from "./src/services/incomingCallNotification";
import { handleIncomingCallMessage } from "./src/services/incomingCallMessages";
import App from "./App";

// This listener also runs headless. Recipient filtering uses persisted identity.
messaging().setBackgroundMessageHandler(async (message) => {
  await handleIncomingCallMessage(message.data);
});

// Notifee dispatches this in headless mode when the user taps an action
// button on the lock screen / heads-up notification (Android only).
notifee.onBackgroundEvent(async (event: Event) => {
  if (event.type !== EventType.ACTION_PRESS && event.type !== EventType.PRESS) return;
  try {
    await handleIncomingCallEvent(event);
  } catch (err) {
    console.warn("[notifee-bg] event handler failed", err);
  }
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
