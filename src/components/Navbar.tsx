"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useApp, getAuthToken } from "@/contexts/AppContext";

const navLinks = {
  student: [
    { href: "/", label: "首页", icon: "🏠" },
    { href: "/tasks", label: "我的任务", icon: "📋" },
    { href: "/knowledge", label: "知识问答", icon: "📚" },
    { href: "/guided", label: "引导学习", icon: "💡" },
    { href: "/sandbox", label: "电子沙盘", icon: "🗺️" },
    { href: "/history", label: "学习档案", icon: "📖" },
  ],
  teacher: [
    { href: "/", label: "首页", icon: "🏠" },
    { href: "/teacher", label: "教学管理", icon: "⚙️" },
    { href: "/knowledge", label: "知识问答", icon: "📚" },
    { href: "/sandbox", label: "电子沙盘", icon: "🗺️" },
  ],
  admin: [
    { href: "/", label: "首页", icon: "🏠" },
    { href: "/admin", label: "账号管理", icon: "🔐" },
    { href: "/teacher", label: "教学管理", icon: "⚙️" },
  ],
};

const authHeaders = () => ({ Authorization: "Bearer " + getAuthToken() });

function maskEmail(email: string): string {
  const [u, d] = String(email).split("@");
  return `${u.slice(0, 1)}***@${d}`;
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { state, logout } = useApp();

  // ── 通知 ──
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);

  const loadNotifs = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications", { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        setNotifs(d.items || []);
        setUnread(d.unread || 0);
      }
    } catch (e) { /* 静默 */ }
  }, []);

  useEffect(() => {
    if (!state.role) return;
    loadNotifs();
    const iv = setInterval(loadNotifs, 60000);
    return () => clearInterval(iv);
  }, [state.role, loadNotifs]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const openNotif = async (n: any) => {
    setNotifOpen(false);
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ id: n.id }),
      });
    } catch (e) { /* 静默 */ }
    if (n.link) router.push(n.link);
    loadNotifs();
  };

  const readAll = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ all: true }),
      });
      loadNotifs();
    } catch (e) { /* 静默 */ }
  };

  // ── 教师发布公告（在通知下拉内） ──
  const [pubTitle, setPubTitle] = useState("");
  const [pubBody, setPubBody] = useState("");
  const [publishing, setPublishing] = useState(false);
  const publishAnnouncement = async () => {
    if (!pubTitle.trim()) return;
    setPublishing(true);
    try {
      const r = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ title: pubTitle.trim(), content: pubBody.trim() }),
      });
      if (r.ok) { setPubTitle(""); setPubBody(""); }
    } catch (e) { /* 静默 */ }
    setPublishing(false);
  };

  // ── 搜索 ──
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ nodes: any[]; tasks: any[]; students: any[]; qa: any[] } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setResults(null); return; }
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { headers: authHeaders() });
      if (r.ok) setResults(await r.json());
    } catch (e) { /* 静默 */ }
  }, []);

  const onSearchInput = (v: string) => {
    setQ(v);
    setSearchOpen(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(v), 300);
  };

  // ══════════════ UNAUTHENTICATED ══════════════
  if (!state.role) {
    return (
      <nav className="bg-white border-b border-[var(--color-border)] shadow-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span className="text-xl">🎓</span>
            <span className="font-bold text-lg text-[var(--color-text)] hidden sm:inline">AI 课程助教</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="px-3 py-2 rounded-lg text-sm font-medium text-[var(--color-text-secondary)] hover:bg-gray-100 transition-colors">登录</Link>
            <Link href="/signup" className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity">注册</Link>
          </div>
        </div>
      </nav>
    );
  }

  const links = navLinks[state.role as keyof typeof navLinks] || navLinks.student;

  return (
    <nav className="bg-white border-b border-[var(--color-border)] shadow-sm sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between gap-3">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-xl">🎓</span>
          <span className="font-bold text-lg text-[var(--color-text)] hidden md:inline">AI 课程助教</span>
        </Link>

        {/* Nav Links */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {links.map((link) => (
            <Link key={link.href} href={link.href}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                pathname === link.href ? "bg-[var(--color-primary-bg)] text-[var(--color-primary)]" : "text-[var(--color-text-secondary)] hover:bg-gray-100 hover:text-[var(--color-text)]"
              }`}>
              <span>{link.icon}</span>
              <span className="hidden lg:inline">{link.label}</span>
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Search */}
          <div className="relative" ref={searchRef}>
            <input
              value={q}
              onChange={(e) => onSearchInput(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              placeholder={state.role === "teacher" ? "搜学生/任务/知识点" : "搜知识点/任务/问答"}
              className="w-36 md:w-52 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:border-[var(--color-primary)] transition-all"
            />
            {searchOpen && q.trim() && results && (
              <div className="absolute right-0 top-10 w-80 bg-white rounded-xl border border-[var(--color-border)] shadow-lg max-h-96 overflow-y-auto z-50">
                {results.nodes.length === 0 && results.tasks.length === 0 && results.students.length === 0 && results.qa.length === 0 && (
                  <p className="px-4 py-3 text-xs text-[var(--color-text-muted)]">没有匹配结果</p>
                )}
                {results.nodes.length > 0 && (
                  <div className="px-3 pt-2 text-[10px] font-semibold text-[var(--color-text-muted)]">知识点</div>
                )}
                {results.nodes.map((n) => (
                  <button key={n.id} onClick={() => { setSearchOpen(false); router.push("/guided"); }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm">
                    <span className="font-medium">📚 {n.name}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)] ml-2">{n.chapter}</span>
                  </button>
                ))}
                {results.tasks.length > 0 && (
                  <div className="px-3 pt-2 text-[10px] font-semibold text-[var(--color-text-muted)]">任务</div>
                )}
                {results.tasks.map((t) => (
                  <button key={t.id} onClick={() => { setSearchOpen(false); router.push(state.role === "teacher" ? `/teacher/tasks/${t.id}` : `/tasks/${t.id}`); }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm">
                    📋 {t.title}
                  </button>
                ))}
                {results.students.length > 0 && (
                  <div className="px-3 pt-2 text-[10px] font-semibold text-[var(--color-text-muted)]">学生</div>
                )}
                {results.students.map((s) => (
                  <button key={s.email} onClick={() => { setSearchOpen(false); router.push(`/teacher/students/${encodeURIComponent(s.email)}`); }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm">
                    🧑‍🎓 {s.name} <span className="text-[10px] text-[var(--color-text-muted)]">{maskEmail(s.email)}</span>
                  </button>
                ))}
                {results.qa.length > 0 && (
                  <div className="px-3 pt-2 text-[10px] font-semibold text-[var(--color-text-muted)]">AI 问答历史</div>
                )}
                {results.qa.map((m) => (
                  <button key={m.id} onClick={() => { setSearchOpen(false); router.push("/history"); }}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm">
                    🤖 {m.question}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 通知铃铛 */}
          <div className="relative" ref={notifRef}>
            <button onClick={() => { setNotifOpen((v) => !v); if (!notifOpen) loadNotifs(); }}
              className="relative px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors" title="通知">
              <span className="text-lg">🔔</span>
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-semibold">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-10 w-96 bg-white rounded-xl border border-[var(--color-border)] shadow-lg z-50 max-h-[70vh] overflow-y-auto">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] sticky top-0 bg-white">
                  <span className="text-sm font-bold">通知</span>
                  {unread > 0 && (
                    <button onClick={readAll} className="text-xs text-[var(--color-primary)] hover:underline">全部已读</button>
                  )}
                </div>
                {state.role === "teacher" && (
                  <div className="px-4 py-3 border-b border-[var(--color-border)] bg-blue-50/50">
                    <div className="text-xs font-semibold text-[var(--color-text)] mb-1.5">📣 发布课程公告</div>
                    <input value={pubTitle} onChange={(e) => setPubTitle(e.target.value)} placeholder="公告标题"
                      className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] text-xs mb-1.5 focus:outline-none focus:border-[var(--color-primary)]" />
                    <textarea value={pubBody} onChange={(e) => setPubBody(e.target.value)} placeholder="公告内容（可选）" rows={2}
                      className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] text-xs mb-1.5 focus:outline-none focus:border-[var(--color-primary)]" />
                    <button onClick={publishAnnouncement} disabled={publishing || !pubTitle.trim()}
                      className="px-3 py-1 rounded bg-[var(--color-primary)] text-white text-xs disabled:opacity-50">发布</button>
                  </div>
                )}
                {notifs.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-[var(--color-text-muted)]">暂无通知</p>
                ) : (
                  notifs.map((n) => (
                    <button key={n.id} onClick={() => openNotif(n)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-[var(--color-border)] last:border-0 ${n.read_at ? "" : "bg-[var(--color-primary-bg)]/40"}`}>
                      <div className="text-sm font-medium text-[var(--color-text)] flex items-start gap-2">
                        {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] mt-1.5 shrink-0" />}
                        <span>{n.title}</span>
                      </div>
                      {n.body && <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{new Date(n.created_at).toLocaleString("zh-CN", { hour12: false })}</p>
                    </button>
                  ))
                )}
                <p className="px-4 py-2.5 text-[10px] text-[var(--color-text-muted)] border-t border-[var(--color-border)]">
                  截止提醒在您访问平台时检查生成；其他通知由任务、批阅等事件即时产生。
                </p>
              </div>
            )}
          </div>

          {/* User Info + Logout */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-sm text-[var(--color-text-secondary)] hidden sm:flex items-center gap-1">
              <span>{state.role === "student" ? "🧑‍🎓" : state.role === "admin" ? "🔐" : "👨‍🏫"}</span>
              <span>{state.userName}</span>
            </div>
            <Link href="/profile" className="text-sm hover:opacity-80" title="个人中心">👤</Link>
            <button onClick={() => logout()} className="px-2 py-1 rounded-md text-xs font-medium text-[var(--color-text-secondary)] hover:text-red-500 hover:bg-red-50 transition-colors">退出</button>
          </div>
        </div>
      </div>

      {/* 公告横幅（学生） */}
      <AnnouncementBanner role={state.role} />
    </nav>
  );
}

/** 学生端公告横幅（可关闭） */
function AnnouncementBanner({ role }: { role: string }) {
  const [ann, setAnn] = useState<any>(null);
  useEffect(() => {
    if (role !== "student") return;
    fetch("/api/announcements", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.announcements;
        if (!list?.length) return;
        const dismissed = Number(localStorage.getItem("announcement-dismissed") || 0);
        const latest = list.find((a: any) => a.id > dismissed);
        if (latest) setAnn(latest);
      })
      .catch(() => {});
  }, [role]);
  if (!ann) return null;
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-3">
      <span>📣</span>
      <div className="flex-1 min-w-0 text-sm text-amber-900">
        <b>{ann.title}</b>{ann.content && <span className="ml-2 text-amber-800/80">{ann.content}</span>}
      </div>
      <button
        onClick={() => { localStorage.setItem("announcement-dismissed", String(ann.id)); setAnn(null); }}
        className="text-xs text-amber-700 hover:underline shrink-0">关闭</button>
    </div>
  );
}
