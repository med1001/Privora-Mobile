import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { cacheIdToken, clearCachedIdToken } from "../services/incomingCallActions";

type AuthContextValue = {
  user: User | null;
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (displayName: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const auth = getFirebaseAuth();
  const managedAuthFlowRef = useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      if (managedAuthFlowRef.current) return;
      if (nextUser && !nextUser.emailVerified) {
        await signOut(auth);
        setUser(null);
        setInitializing(false);
        await clearCachedIdToken();
        return;
      }
      setUser(nextUser);
      setInitializing(false);
      if (nextUser) {
        try {
          const token = await nextUser.getIdToken();
          await cacheIdToken(token);
        } catch {
          // best-effort; the token will be refreshed on the next API call.
        }
      } else {
        await clearCachedIdToken();
      }
    });

    return unsubscribe;
  }, [auth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,
      async login(email, password) {
        managedAuthFlowRef.current = true;
        try {
          const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
          if (!credential.user.emailVerified) {
            await signOut(auth);
            setUser(null);
            throw new Error("Please verify your email before logging in.");
          }
          setUser(credential.user);
          const token = await credential.user.getIdToken();
          await cacheIdToken(token);
        } finally {
          managedAuthFlowRef.current = false;
        }
      },
      async register(displayName, email, password) {
        managedAuthFlowRef.current = true;
        try {
          const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
          await updateProfile(credential.user, { displayName: displayName.trim() });
          await sendEmailVerification(credential.user);
          await signOut(auth);
          setUser(null);
          await clearCachedIdToken();
        } finally {
          managedAuthFlowRef.current = false;
        }
      },
      async resetPassword(email) {
        await sendPasswordResetEmail(auth, email.trim());
      },
      async logout() {
        await signOut(auth);
      },
      async getIdToken() {
        const target = user ?? auth.currentUser;
        if (!target) {
          throw new Error("No authenticated user found.");
        }
        const token = await target.getIdToken();
        await cacheIdToken(token);
        return token;
      },
    }),
    [auth, initializing, user],
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
