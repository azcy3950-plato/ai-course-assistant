"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/contexts/AppContext";
import type { UserRole } from "@/types";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams?.get("redirect") ?? "/";
  const { state, signup } = useApp();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState<UserRole>("student");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Already logged in → go home
  useEffect(() => {
    if (!state.authLoading && state.role) {
      router.replace("/");
    }
  }, [state.authLoading, state.role, router]);

  const validate = (): string | null => {
    if (!name.trim()) return "请输入姓名";
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email))
      return "请输入有效的邮箱地址";
    if (password.length < 6) return "密码至少 6 位";
    if (password !== confirmPassword) return "两次密码不一致";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    const result = await signup(email, password, name.trim(), selectedRole);
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
    <div className="max-w-md mx-auto mt-8 px-4">
      <div className="bg-white rounded-2xl border border-[var(--color-border)] p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-6 text-center">
          注册
        </h1>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              姓名
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入姓名"
              required
              className="w-full px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-all"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              邮箱
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-all"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              required
              className="w-full px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-all"
            />
          </div>

          {/* Confirm password */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              确认密码
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入密码"
              required
              className="w-full px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-all"
            />
          </div>

          {/* Role Selector */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              身份
            </label>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setSelectedRole("student")}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  selectedRole === "student"
                    ? "bg-white text-[var(--color-primary)] shadow-sm"
                    : "text-[var(--color-text-secondary)]"
                }`}
              >
                🧑‍🎓 学生
              </button>
              <button
                type="button"
                onClick={() => setSelectedRole("teacher")}
                disabled
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors opacity-50 cursor-not-allowed ${
                  selectedRole === "teacher"
                    ? "bg-white text-[var(--color-primary)] shadow-sm"
                    : "text-[var(--color-text-secondary)]"
                }`}
                title="教师账号由管理员开通"
              >
                👨‍🏫 教师（管理员开通）
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {loading ? "注册中..." : "注册"}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-[var(--color-text-muted)]">
          已有账号？{" "}
          <Link
            href="/login"
            className="text-[var(--color-primary)] hover:underline"
          >
            立即登录
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
export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">
          加载中...
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
