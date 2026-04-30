import Constants from "expo-constants";

type ExtraConfig = {
  apiBaseUrl?: string;
  wsUrl?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  firebaseStorageBucket?: string;
  firebaseMessagingSenderId?: string;
  firebaseAppId?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

export const config = {
  apiBaseUrl: extra.apiBaseUrl ?? "http://10.0.2.2:8000",
  wsUrl: extra.wsUrl ?? "ws://10.0.2.2:8000/ws",
  firebase: {
    // Force env-based key to prevent reintroducing it in tracked config.
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: extra.firebaseAuthDomain ?? "",
    projectId: extra.firebaseProjectId ?? "",
    storageBucket: extra.firebaseStorageBucket ?? "",
    messagingSenderId: extra.firebaseMessagingSenderId ?? "",
    appId: extra.firebaseAppId ?? "",
  },
};

export function assertFirebaseConfigured() {
  const required = Object.entries(config.firebase).filter(([, value]) => !value);
  if (required.length > 0) {
    throw new Error(
      `Firebase config missing fields: ${required.map(([key]) => key).join(", ")}. Set EXPO_PUBLIC_FIREBASE_API_KEY in .env and remaining fields in app.json > expo.extra.`,
    );
  }
}
