"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/contexts/AppContext";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams?.get("redirect") ?? "/";
  const { state, signup, sendVerificationCode } = useApp();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 验证码发送状态
  const [sending, setSending] = useState(false);
  const [sentMasked, setSentMasked] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // Already logged in → go home
  useEffect(() => {
    if (!state.authLoading && state.role) {
      router.replace("/");
    }
  }, [state.authLoading, state.role, router]);

  const handleSendCode = async () => {
    setError(null);
    const v = email.trim();
    if (!v || !/\S+@\S+\.\S+/.test(v)) {
      setError("请输入有效的邮箱地址");
      return;
    }
    setSending(true);
    const result = await sendVerificationCode(v, "REGISTER");
    setSending(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSentMasked(result.masked || "");
      setCountdown(result.retryAfter || 60);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) { if (timerRef.current) clearInterval(timerRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
    }
  };

  const validate = (): string | null => {
    if (!name.trim()) return "请输入姓名";
    if (!/\S+@\S+\.\S+/.test(email.trim())) return "请输入有效的邮箱地址";
    if (!/^\d{6}$/.test(code.trim())) return "请输入 6 位验证码";
    if (password.length < 8) return "密码至少 8 位";
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return "密码需同时包含字母和数字";
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
    const result = await signup(email.trim(), "EMAIL", code.trim(), password, name.trim());
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

  const inputCls = "w-full px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-all";

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
              className={inputCls}
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
              className={inputCls}
            />
          </div>

          {/* Verification code */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              验证码
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="6 位数字验证码"
                required
                className={inputCls}
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={sending || countdown > 0}
                className="shrink-0 px-4 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary)] text-sm font-medium hover:bg-[var(--color-primary-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {sending ? "发送中..." : countdown > 0 ? `${countdown}s 后重发` : "获取验证码"}
              </button>
            </div>
            {sentMasked && (
              <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
                验证码已发送至 {sentMasked}（5 分钟内有效，请查收邮件）
              </p>
            )}
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
              placeholder="至少 8 位，需包含字母和数字"
              required
              className={inputCls}
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
              className={inputCls}
            />
          </div>

          {/* Role note */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <span className="flex-1 px-4 py-2 rounded-md text-sm font-medium bg-white text-[var(--color-primary)] shadow-sm text-center">
              🧑‍🎓 学生
            </span>
            <span
              className="flex-1 px-4 py-2 rounded-md text-sm font-medium opacity-50 cursor-not-allowed text-center"
              title="教师账号由管理员开通"
            >
              👨‍🏫 教师（管理员开通）
            </span>
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
