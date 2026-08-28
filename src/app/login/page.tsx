"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/contexts/AppContext";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams?.get("redirect") ?? "/";
  const { state, login } = useApp();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Already logged in → go home
  useEffect(() => {
    if (!state.authLoading && state.role) {
      router.replace("/");
    }
  }, [state.authLoading, state.role, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!identifier.trim()) { setError("请输入邮箱地址"); return; }
    setLoading(true);
    const result = await login(identifier.trim(), password);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      router.push(redirectTo);
    }
  };

  if (state.authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">
        加载中...
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-12 px-4">
      <div className="bg-white rounded-2xl border border-[var(--color-border)] p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-6 text-center">
          登录
        </h1>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              账号
            </label>
            <input
              type="email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="你的邮箱"
              required
              className="w-full px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-all"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-[var(--color-text)]">
                密码
              </label>
              <Link href="/forgot-password" className="text-xs text-[var(--color-primary)] hover:underline">
                忘记密码？
              </Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
              className="w-full px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-[var(--color-text-muted)]">
          没有账号？{" "}
          <Link
            href="/signup"
            className="text-[var(--color-primary)] hover:underline"
          >
            立即注册
          </Link>
        </div>
      </div>

      <div className="mt-4 text-center">
        <Link
          href="/"
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}

// Wrap in Suspense: useSearchParams() requires it in static export
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">
          加载中...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
