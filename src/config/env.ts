import Constants from "expo-constants";

type ExtraConfig = {
  apiBaseUrl?: string;
  wsUrl?: string;
  firebaseApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
  firebaseStorageBucket?: string;
  firebaseMessagingSenderId?: string;
  firebaseAppId?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

export const config = {
  apiBaseUrl: extra.apiBaseUrl ?? "http://10.0.2.2:8080",
  wsUrl: extra.wsUrl ?? "ws://10.0.2.2:8080/ws",
  firebase: {
    apiKey: extra.firebaseApiKey ?? "",
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
      `Firebase config missing fields: ${required.map(([key]) => key).join(", ")}. Add them in app.json > expo.extra.`,
    );
  }
}
