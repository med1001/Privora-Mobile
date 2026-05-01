import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirebaseAuth } from "../services/firebase";
import { cacheIdToken, clearCachedIdToken } from "../services/incomingCallActions";

type AuthContextValue = {
  user: User | null;
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const auth = getFirebaseAuth();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
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
        await signInWithEmailAndPassword(auth, email.trim(), password);
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
