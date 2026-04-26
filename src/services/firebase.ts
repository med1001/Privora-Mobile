import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth, initializeAuth, Auth } from "firebase/auth";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { assertFirebaseConfigured, config } from "../config/env";

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;

export function getFirebaseApp() {
  if (appInstance) return appInstance;
  assertFirebaseConfigured();
  appInstance = getApps()[0] ?? initializeApp(config.firebase);
  return appInstance;
}

export function getFirebaseAuth() {
  if (authInstance) return authInstance;
  const app = getFirebaseApp();

  // Firebase's React Native persistence helper is available at runtime,
  // but may not always be surfaced by typings across versions.
  const authModule = require("firebase/auth") as {
    getReactNativePersistence?: (storage: unknown) => unknown;
  };
  const getReactNativePersistence = authModule.getReactNativePersistence;

  if (getReactNativePersistence) {
    try {
      authInstance = initializeAuth(app, {
        persistence: getReactNativePersistence(ReactNativeAsyncStorage),
      } as any);
      return authInstance;
    } catch {
      // initializeAuth can throw if auth is already initialized for this app.
    }
  }

  authInstance = getAuth(app);
  return authInstance;
}
