"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp, getAuthToken } from "@/contexts/AppContext";

const navLinks = {
  student: [
    { href: "/", label: "首页", icon: "🏠" },
    { href: "/knowledge", label: "知识问答", icon: "📚" },
    { href: "/guided", label: "引导学习", icon: "💡" },
    { href: "/sandbox", label: "电子沙盘", icon: "🗺️" },
    { href: "/records", label: "学习记录", icon: "📋" },
  ],
  teacher: [
    { href: "/", label: "首页", icon: "🏠" },
    { href: "/teacher", label: "教学管理", icon: "⚙️" },
    { href: "/knowledge", label: "知识问答", icon: "📚" },
    { href: "/guided", label: "引导学习", icon: "💡" },
    { href: "/sandbox", label: "电子沙盘", icon: "🗺️" },
  ],
};

export default function Navbar() {
  const pathname = usePathname();
  const { state, logout } = useApp();
  const [banner, setBanner] = useState<{ id: number; title: string; content: string } | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState<number | null>(null);

  // 课程公告横幅:登录后拉取最新公告(关闭按钮按 id 记录,不重复弹)
  useEffect(() => {
    if (!state.role) return;
    let cancelled = false;
    fetch("/api/announcements", { headers: { Authorization: `Bearer ${getAuthToken()}` } })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list = d.announcements || [];
        if (!list.length) return;
        let dismissed = 0;
        try { dismissed = Number(localStorage.getItem("announcement-dismissed")) || 0; } catch { /* 忽略 */ }
        const latest = list.find((a: { id: number }) => a.id > dismissed) || null;
        if (latest) setBanner({ id: latest.id, title: latest.title, content: latest.content });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [state.role]);
  const dismissBanner = () => {
    if (!banner) return;
    try { localStorage.setItem("announcement-dismissed", String(banner.id)); } catch { /* 忽略 */ }
    setBanner(null);
    setBannerDismissed(banner.id);
  };

  // ══════════════ UNAUTHENTICATED ══════════════
  if (!state.role) {
    return (
      <nav className="bg-white border-b border-[var(--color-border)] shadow-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span className="text-xl">🎓</span>
            <span className="font-bold text-lg text-[var(--color-text)] hidden sm:inline">
              AI 课程助教
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="px-3 py-2 rounded-lg text-sm font-medium text-[var(--color-text-secondary)] hover:bg-gray-100 transition-colors"
            >
              登录
            </Link>
            <Link
              href="/signup"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity"
            >
              注册
            </Link>
          </div>
        </div>
      </nav>
    );
  }

  // ══════════════ AUTHENTICATED ══════════════
  const links = navLinks[state.role];

  return (
    <div className="sticky top-0 z-50">
    {banner && banner.id !== bannerDismissed && (
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="max-w-[1600px] mx-auto px-4 py-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs font-bold text-amber-700">📣 公告: {banner.title}</span>
            {banner.content && <p className="text-xs text-amber-800 mt-0.5 whitespace-pre-wrap">{banner.content}</p>}
          </div>
          <button onClick={dismissBanner} aria-label="关闭公告" className="shrink-0 text-xs text-amber-500 hover:text-amber-700">✕</button>
        </div>
      </div>
    )}
    <nav className="bg-white border-b border-[var(--color-border)] shadow-sm">
      <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-xl">🎓</span>
          <span className="font-bold text-lg text-[var(--color-text)] hidden sm:inline">
            AI 课程助教
          </span>
        </Link>

        {/* Nav Links */}
        <div className="flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                pathname === link.href
                  ? "bg-[var(--color-primary-bg)] text-[var(--color-primary)]"
                  : "text-[var(--color-text-secondary)] hover:bg-gray-100 hover:text-[var(--color-text)]"
              }`}
            >
              <span>{link.icon}</span>
              <span className="hidden md:inline">{link.label}</span>
            </Link>
          ))}
        </div>

        {/* User Info + Logout */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-sm text-[var(--color-text-secondary)] hidden sm:flex items-center gap-1">
            <span>{state.role === "student" ? "🧑‍🎓" : "👨‍🏫"}</span>
            <span>{state.userName}</span>
          </div>
          <Link href="/profile" className="px-2.5 py-1 rounded-md text-xs font-medium text-[var(--color-text-secondary)] hover:text-amber-600 hover:bg-amber-50 transition-colors">
            👤 个人中心
          </Link>
          <button
            onClick={() => logout()}
            className="px-2.5 py-1 rounded-md text-xs font-medium text-[var(--color-text-secondary)] hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            退出
          </button>
        </div>
      </div>
    </nav>
    </div>
  );
}
