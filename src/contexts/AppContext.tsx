"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { type User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { AppState, UserRole } from "@/types";

const initialState: AppState = {
  role: null,
  userName: null,
  authLoading: true,
};

interface AppContextValue {
  state: AppState;
  login: (
    email: string,
    password: string
  ) => Promise<{ error: string | null }>;
  signup: (
    email: string,
    password: string,
    name: string,
    role: UserRole
  ) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

function deriveUserInfo(user: User | null): {
  role: UserRole | null;
  userName: string | null;
} {
  if (!user) return { role: null, userName: null };
  const role =
    (user.user_metadata?.role as UserRole) || "student";
  const name =
    (user.user_metadata?.name as string) ||
    user.email?.split("@")[0] ||
    "用户";
  return { role, userName: name };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);

  const updateAuthState = useCallback((user: User | null) => {
    const { role, userName } = deriveUserInfo(user);
    setState({ role, userName, authLoading: false });
  }, []);

  // ── Session recovery + real-time listener ──
  useEffect(() => {
    // 1) Recover any existing session (refresh-token auto-handled)
    supabase.auth.getSession().then(({ data: { session } }) => {
      updateAuthState(session?.user ?? null);
    });

    // 2) Listen for login / logout / token-refresh events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      updateAuthState(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [updateAuthState]);

  // ── Public API ──

  const login = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { error: error?.message ?? null };
    },
    []
  );

  const signup = useCallback(
    async (
      email: string,
      password: string,
      name: string,
      role: UserRole
    ) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { role, name } },
      });
      return { error: error?.message ?? null };
    },
    []
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AppContext.Provider value={{ state, login, signup, logout }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
