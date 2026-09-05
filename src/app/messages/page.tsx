"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp, getAuthToken } from "@/contexts/AppContext";

const authHeaders = () => ({ Authorization: "Bearer " + getAuthToken() });

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return d.toLocaleString("zh-CN", sameDay
    ? { hour: "2-digit", minute: "2-digit", hour12: false }
    : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function MessagesInboxPage() {
  const { state } = useApp();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state.authLoading) return;
    if (!state.role) router.replace("/login?redirect=" + encodeURIComponent("/messages"));
    else if (state.role === "admin") router.replace("/");
    else setAuthorized(true);
  }, [state.authLoading, state.role, router]);

  useEffect(() => {
    if (!authorized) return;
    fetch("/api/messages", { headers: authHeaders() })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "加载失败");
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, [authorized]);

  if (state.authLoading || !authorized) {
    return <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">加载中...</div>;
  }

  const myRole = state.role;
  const conversations = data?.conversations || [];
  const availablePeers = data?.availablePeers || [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">💬 我的私信</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {myRole === "student" ? "向任课教师提问答疑，教师回复后会在这里与通知中心提醒你" : "回复学生的疑问，从「学生详情」页也可以直接发起私信"}
        </p>
      </div>

      {error && (
        <p className="p-4 text-center text-sm text-red-500 bg-red-50 rounded-xl mb-4">{error}</p>
      )}

      {!data && !error && (
        <div className="flex items-center justify-center min-h-[40vh] text-[var(--color-text-muted)]">加载中...</div>
      )}

      {data && conversations.length === 0 && (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
          <p className="text-3xl mb-3">📭</p>
          {myRole === "student" ? (
            availablePeers.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">你还没有加入任何班级，暂无可联系的教师</p>
            ) : (
              <>
                <p className="text-sm text-[var(--color-text-muted)] mb-5">还没有会话，选择一位任课教师开始提问吧</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                  {availablePeers.map((t: any) => (
                    <Link key={t.teacher_email}
                      href={"/messages/" + encodeURIComponent(t.teacher_email)}
                      className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] p-3 hover:border-[var(--color-primary)] transition-colors">
                      <span className="text-2xl">👨‍🏫</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-[var(--color-text)] truncate">{t.teacher_name || t.teacher_email}</span>
                        <span className="block text-xs text-[var(--color-text-muted)] truncate">{t.teacher_email}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            )
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">
              尚无会话。打开「教学管理 → 班级」中任一学生的「学生详情」页，点击「💬 私信该学生」即可发起。
            </p>
          )}
        </div>
      )}

      {data && conversations.length > 0 && (
        <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden divide-y divide-[var(--color-border)]">
          {conversations.map((c: any) => {
            const peerIsTeacher = myRole === "student";
            return (
              <Link key={c.peer_email} href={"/messages/" + encodeURIComponent(c.peer_email)}
                className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${c.unread > 0 ? "bg-[var(--color-primary-bg)]/30" : ""}`}>
                <span className="text-2xl shrink-0">{peerIsTeacher ? "👨‍🏫" : "🧑‍🎓"}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--color-text)] truncate">{c.peer_name || c.peer_email}</span>
                    {c.unread > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-primary)] text-white text-[10px] flex items-center justify-center font-semibold shrink-0">
                        {c.unread > 99 ? "99+" : c.unread}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-[var(--color-text-secondary)] truncate mt-0.5">
                    {c.last_sender === data.me ? "我：" : ""}{c.last_body}
                  </span>
                </span>
                <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{formatTime(c.last_at)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
