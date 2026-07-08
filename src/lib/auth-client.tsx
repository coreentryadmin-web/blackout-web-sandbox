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

const unloaded: AppAuthState = {
  isLoaded: false,
  isSignedIn: false,
  userId: null,
  email: null,
  tier: null,
  signOut: () => {},
};

const CognitoAuthContext = createContext<AppAuthState | null>(null);
const ClerkAuthContext = createContext<AppAuthState | null>(null);

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

  const value = useMemo<AppAuthState>(() => ({ ...state, signOut }), [state, signOut]);

  return <CognitoAuthContext.Provider value={value}>{children}</CognitoAuthContext.Provider>;
}

/** Must render under ClerkProvider — hooks live here, not in useAppAuth. */
function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const clerk = useClerkAuth();
  const { user } = useClerkUser();
  const tier = (user?.publicMetadata as { tier?: string } | undefined)?.tier ?? null;

  const value = useMemo<AppAuthState>(
    () => ({
      isLoaded: clerk.isLoaded,
      isSignedIn: Boolean(clerk.isSignedIn),
      userId: clerk.userId ?? null,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      tier,
      signOut: () => {
        void clerk.signOut?.();
      },
    }),
    [clerk.isLoaded, clerk.isSignedIn, clerk.userId, clerk.signOut, user, tier]
  );

  return <ClerkAuthContext.Provider value={value}>{children}</ClerkAuthContext.Provider>;
}

export function useAppAuth(): AppAuthState {
  const cognitoCtx = useContext(CognitoAuthContext);
  const clerkCtx = useContext(ClerkAuthContext);

  if (isClientCognitoAuth()) {
    return (
      cognitoCtx ?? {
        ...unloaded,
        signOut: () => {
          window.location.href = "/api/auth/cognito/logout";
        },
      }
    );
  }

  return clerkCtx ?? unloaded;
}

export { CognitoAuthProvider, ClerkAuthBridge };
