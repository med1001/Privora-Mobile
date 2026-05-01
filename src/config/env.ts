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

/** Must stay aligned with `app.config.js` defaults (production). */
const DEFAULT_API = "https://privora-app.com";
const DEFAULT_WS = "wss://privora-app.com/ws";

export const config = {
  apiBaseUrl: extra.apiBaseUrl ?? DEFAULT_API,
  wsUrl: extra.wsUrl ?? DEFAULT_WS,
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
