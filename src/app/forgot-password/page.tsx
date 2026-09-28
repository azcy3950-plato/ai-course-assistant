"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/contexts/AppContext";

const STEPS = ["输入账号", "验证验证码", "设置新密码", "完成"];

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { sendVerificationCode, verifyCode, resetPassword } = useApp();

  const [step, setStep] = useState(0); // 0..3
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [sending, setSending] = useState(false);
  const [sentMasked, setSentMasked] = useState<string | null>(null);
  const [echoCode, setEchoCode] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const handleSend = async () => {
    setError(null);
    const v = identifier.trim();
    if (!v) { setError("请输入邮箱地址"); return; }
    setSending(true);
    const result = await sendVerificationCode(v, "RESET_PASSWORD");
    setSending(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSentMasked(result.masked || "");
      setEchoCode(result.echoCode || null);
      setCountdown(result.retryAfter || 60);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) { if (timerRef.current) clearInterval(timerRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
      setStep(1);
    }
  };

  const handleVerify = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) { setError("请输入 6 位验证码"); return; }
    setLoading(true);
    const result = await verifyCode(identifier.trim(), "RESET_PASSWORD", code.trim());
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else if (result.resetToken) {
      setResetToken(result.resetToken);
      setStep(2);
    } else {
      setError("验证码错误或已失效");
    }
  };

  const handleReset = async () => {
    setError(null);
    if (newPassword.length < 8) { setError("密码至少 8 位"); return; }
    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) { setError("密码需同时包含字母和数字"); return; }
    if (newPassword !== confirmPassword) { setError("两次密码不一致"); return; }
    setLoading(true);
    const result = await resetPassword(identifier.trim(), resetToken, newPassword);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setStep(3);
    }
  };

  const inputCls = "w-full px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-all";

  return (
    <div className="max-w-md mx-auto mt-12 px-4">
      <div className="bg-white rounded-2xl border border-[var(--color-border)] p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-6 text-center">
          找回密码
        </h1>

        {/* 步骤指示 */}
        <div className="flex items-center justify-between mb-6">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div className="flex flex-col items-center gap-1">
                <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-medium ${
                  step > i ? "bg-[var(--color-primary)] text-white" : step === i ? "bg-[var(--color-primary-bg)] text-[var(--color-primary)] border border-[var(--color-primary)]" : "bg-gray-100 text-[var(--color-text-muted)]"
                }`}>
                  {step > i ? "✓" : i + 1}
                </span>
                <span className={`text-[10px] ${step === i ? "text-[var(--color-primary)] font-medium" : "text-[var(--color-text-muted)]"}`}>{s}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`flex-1 h-px mx-2 ${step > i ? "bg-[var(--color-primary)]" : "bg-gray-200"}`} />}
            </React.Fragment>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {step === 0 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                邮箱
              </label>
              <input
                type="email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="请输入注册时使用的邮箱"
                className={inputCls}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={sending || !identifier.trim()}
              className="w-full py-2.5 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {sending ? "发送中..." : "获取验证码"}
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-xs text-[var(--color-text-muted)]">
              验证码已发送至 <b className="text-[var(--color-text)]">{sentMasked}</b>（5 分钟内有效，请勿泄露）
            </p>
            {echoCode && (
              <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                ⚠️ 开发测试模式（未配置真实短信/邮件服务）：本次验证码为 <b>{echoCode}</b>
              </p>
            )}
            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                验证码
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="6 位数字验证码"
                className={inputCls}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleVerify}
                disabled={loading}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {loading ? "验证中..." : "验证"}
              </button>
              <button
                onClick={handleSend}
                disabled={sending || countdown > 0}
                className="px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:bg-gray-50 disabled:opacity-50"
              >
                {countdown > 0 ? `${countdown}s` : "重新发送"}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                新密码
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 8 位，需包含字母和数字"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                确认新密码
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入新密码"
                className={inputCls}
              />
            </div>
            <button
              onClick={handleReset}
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {loading ? "提交中..." : "重置密码"}
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="text-center py-4">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-sm font-semibold text-[var(--color-text)] mb-1">密码已重置，请重新登录</p>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">出于安全考虑，该账号的其他登录已失效</p>
            <button
              onClick={() => router.push("/login")}
              className="px-6 py-2.5 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity"
            >
              返回登录
            </button>
          </div>
        )}

        {step < 3 && (
          <div className="mt-4 text-center text-sm text-[var(--color-text-muted)]">
            想起密码了？{" "}
            <Link href="/login" className="text-[var(--color-primary)] hover:underline">
              返回登录
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
