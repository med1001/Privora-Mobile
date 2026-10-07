import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { getFirebaseAuth } from "../services/firebase";
import { AppState } from "react-native";
import { cacheIdToken } from "../services/pushIdentity";
import { startPushSession, stopPushSession, registerPushNotifications } from "../services/pushNotifications";

type AuthContextValue = {
  user: User | null;
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (displayName: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const auth = getFirebaseAuth();
  const managedAuthFlowRef = useRef(false);

  const sessionUserRef = useRef<User | null>(null);
  const sessionRevision = useRef(0);
  const logoutPromiseRef = useRef<Promise<void> | null>(null);

  const applyUser = useCallback(async (nextUser: User | null) => {
    const revision = ++sessionRevision.current;
    sessionUserRef.current = nextUser;
    if (nextUser) {
      try {
        // Establish recipient filtering before rendering authenticated routes.
        await startPushSession({
          uid: nextUser.uid, email: nextUser.email,
          getIdToken: () => nextUser.getIdToken(),
        });
      } catch {
        console.warn("[push] unable to persist recipient; push remains disabled");
      }
      if (revision !== sessionRevision.current) return;
      setUser(nextUser);
      setInitializing(false);
      void registerPushNotifications();
      try {
        const token = await nextUser.getIdToken();
        if (revision === sessionRevision.current) await cacheIdToken(token, nextUser.email ?? "");
      } catch {
        // Retry with the next authenticated request / foreground transition.
      }
    } else {
      const cleanup = stopPushSession();
      setUser(null);
      setInitializing(false);
      await cleanup;
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      if (managedAuthFlowRef.current) return;
      void (async () => {
        if (nextUser && !nextUser.emailVerified) {
          await applyUser(null);
          await signOut(auth);
          return;
        }
        await applyUser(nextUser);
      })().catch(() => console.warn("[auth] session transition failed"));
    });
  }, [auth, applyUser]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && sessionUserRef.current && !logoutPromiseRef.current) {
        void registerPushNotifications();
      }
    });
    return () => subscription.remove();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,
      async login(email, password) {
        await logoutPromiseRef.current;
        managedAuthFlowRef.current = true;
        try {
          const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
          if (!credential.user.emailVerified) {
            await signOut(auth);
            await applyUser(null);
            throw new Error("Please verify your email before logging in.");
          }
          await applyUser(credential.user);
        } finally {
          managedAuthFlowRef.current = false;
        }
      },
      async register(displayName, email, password) {
        await logoutPromiseRef.current;
        managedAuthFlowRef.current = true;
        try {
          const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
          await updateProfile(credential.user, { displayName: displayName.trim() });
          await sendEmailVerification(credential.user);
          await signOut(auth);
          await applyUser(null);
        } finally {
          managedAuthFlowRef.current = false;
        }
      },
      async resetPassword(email) {
        await sendPasswordResetEmail(auth, email.trim());
      },
      logout() {
        if (logoutPromiseRef.current) return logoutPromiseRef.current;
        managedAuthFlowRef.current = true;
        const work = (async () => {
          try {
            // Captured account credentials remain valid until unregister settles.
            await applyUser(null);
            await signOut(auth);
          } finally {
            managedAuthFlowRef.current = false;
            logoutPromiseRef.current = null;
          }
        })();
        logoutPromiseRef.current = work;
        return work;
      },
      async getIdToken(forceRefresh = false) {
        const target = sessionUserRef.current;
        if (!target || target.uid !== user?.uid) {
          throw Object.assign(new Error("No authenticated user found."), { code: "auth/session-changed" });
        }
        const token = await target.getIdToken(forceRefresh);
        if (sessionUserRef.current !== target || logoutPromiseRef.current) {
          throw Object.assign(new Error("Authentication session changed."), { code: "auth/session-changed" });
        }
        await cacheIdToken(token, target.email ?? "");
        if (sessionUserRef.current !== target) throw Object.assign(new Error("Authentication session changed."), { code: "auth/session-changed" });
        return token;
      },
    }),
    [auth, initializing, user, applyUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return ctx;
}
