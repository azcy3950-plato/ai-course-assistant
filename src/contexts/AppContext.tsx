"use client";

import React, {
  createContext, useContext, useState, useEffect, useCallback, type ReactNode,
} from "react";
import type { AppState, UserRole } from "@/types";

const TOKEN_KEY = "aicourse-token";
const USER_KEY = "aicourse-user";

const initialState: AppState = {
  role: null,
  userName: null,
  authLoading: true,
};

interface AppContextValue {
  state: AppState;
  darkMode: boolean;
  toggleDarkMode: () => void;
  login: (email: string, password: string) => Promise<{ error: string | null }>;
  signup: (email: string, password: string, name: string, role: UserRole) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const [darkMode, setDarkMode] = useState(false);

  // Dark mode init
  useEffect(() => {
    const saved = localStorage.getItem("aicourse-dark");
    const prefers = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = saved !== null ? saved === "true" : prefers;
    setDarkMode(isDark);
    if (isDark) document.documentElement.classList.add("dark");
  }, []);

  const toggleDarkMode = useCallback(() => {
    setDarkMode(prev => {
      const next = !prev;
      localStorage.setItem("aicourse-dark", String(next));
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  }, []);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);
    if (token && savedUser) {
      try {
        const user = JSON.parse(savedUser);
        setState({ role: user.role, userName: user.name, authLoading: false });
        // Validate token in background
        fetch("/api/auth/me", { headers: { Authorization: "Bearer " + token } })
          .then(r => { if (!r.ok) { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); setState({ role: null, userName: null, authLoading: false }); } })
          .catch(() => {});
      } catch {
        setState({ role: null, userName: null, authLoading: false });
      }
    } else {
      setState({ role: null, userName: null, authLoading: false });
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || "登录失败" };

      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setState({ role: data.user.role, userName: data.user.name, authLoading: false });
      return { error: null };
    } catch {
      return { error: "网络错误，请重试" };
    }
  }, []);

  const signup = useCallback(async (email: string, password: string, name: string, role: UserRole) => {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, role }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || "注册失败" };

      // Auto-login after signup
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const loginData = await loginRes.json();
      if (loginRes.ok) {
        localStorage.setItem(TOKEN_KEY, loginData.token);
        localStorage.setItem(USER_KEY, JSON.stringify(loginData.user));
        setState({ role: loginData.user.role, userName: loginData.user.name, authLoading: false });
      }
      return { error: null };
    } catch {
      return { error: "网络错误，请重试" };
    }
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ role: null, userName: null, authLoading: false });
  }, []);

  return (
    <AppContext.Provider value={{ state, darkMode, toggleDarkMode, login, signup, logout }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

// Helper for other components to get auth token
export function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) || "";
}
