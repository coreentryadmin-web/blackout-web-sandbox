"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth as useClerkAuth, useUser as useClerkUser } from "@clerk/nextjs";
import { isClientCognitoAuth } from "@/lib/auth-provider";

export type AppAuthState = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  email: string | null;
  tier: string | null;
  signOut: () => void;
};

const CognitoAuthContext = createContext<AppAuthState | null>(null);

function CognitoAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AppAuthState, "signOut">>({
    isLoaded: false,
    isSignedIn: false,
    userId: null,
    email: null,
    tier: null,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      const data = (await res.json()) as {
        signedIn?: boolean;
        userId?: string | null;
        email?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        tier?: string | null;
      };
      setState({
        isLoaded: true,
        isSignedIn: Boolean(data.signedIn),
        userId: data.userId ?? null,
        email: data.email ?? null,
        tier: data.tier ?? null,
      });
    } catch {
      setState({ isLoaded: true, isSignedIn: false, userId: null, email: null, tier: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(() => {
    window.location.href = "/api/auth/cognito/logout";
  }, []);

  const value = useMemo<AppAuthState>(
    () => ({ ...state, signOut }),
    [state, signOut]
  );

  return <CognitoAuthContext.Provider value={value}>{children}</CognitoAuthContext.Provider>;
}

export function useAppAuth(): AppAuthState {
  const cognitoCtx = useContext(CognitoAuthContext);

  if (isClientCognitoAuth()) {
    if (!cognitoCtx) {
      return {
        isLoaded: false,
        isSignedIn: false,
        userId: null,
        email: null,
        tier: null,
        signOut: () => {
          window.location.href = "/api/auth/cognito/logout";
        },
      };
    }
    return cognitoCtx;
  }

  const clerk = useClerkAuth();
  const { user } = useClerkUser();
  const tier = (user?.publicMetadata as { tier?: string } | undefined)?.tier ?? null;
  return {
    isLoaded: clerk.isLoaded,
    isSignedIn: Boolean(clerk.isSignedIn),
    userId: clerk.userId ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    tier,
    signOut: () => {
      void clerk.signOut?.();
    },
  };
}

export { CognitoAuthProvider };
