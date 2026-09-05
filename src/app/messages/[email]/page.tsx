"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useApp, getAuthToken } from "@/contexts/AppContext";
import ChatInput from "@/components/ChatInput";

const authHeaders = () => ({ Authorization: "Bearer " + getAuthToken() });

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function MessageThreadPage() {
  const { state } = useApp();
  const router = useRouter();
  const params = useParams();
  const peerEmail = decodeURIComponent(String(params?.email || ""));
  const [authorized, setAuthorized] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<any[]>([]);

  useEffect(() => {
    if (state.authLoading) return;
    if (!state.role) router.replace("/login?redirect=" + encodeURIComponent("/messages/" + encodeURIComponent(peerEmail)));
    else if (state.role === "admin") router.replace("/");
    else setAuthorized(true);
  }, [state.authLoading, state.role, router, peerEmail]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/messages?with=" + encodeURIComponent(peerEmail), { headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "加载失败");
      setData(d);
      messagesRef.current = d.messages || [];
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [peerEmail]);

  useEffect(() => {
    if (!authorized) return;
    load();
    // 打开会话即标已读，并通知 Navbar 立即刷新角标
    fetch("/api/messages/read", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ with: peerEmail }),
    }).then(() => window.dispatchEvent(new Event("dm-unread"))).catch(() => {});
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, [authorized, load, peerEmail]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [data?.messages?.length]);

  const send = async (text: string) => {
    if (sending) return;
    setSending(true);
    try {
      const r = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ with: peerEmail, body: text }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "发送失败"); return; }
      const next = [...messagesRef.current, d.message];
      messagesRef.current = next;
      setData((prev: any) => (prev ? { ...prev, messages: next } : prev));
    } catch (e: any) {
      setError(e.message || "发送失败");
    } finally {
      setSending(false);
    }
  };

  if (state.authLoading || !authorized) {
    return <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">加载中...</div>;
  }

  const messages = data?.messages || [];
  const me = data?.me || "";

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] max-w-3xl mx-auto w-full">
      {/* 头部 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-[var(--color-border)]">
        <Link href="/messages" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] shrink-0">← 返回</Link>
        <span className="text-2xl">{state.role === "student" ? "👨‍🏫" : "🧑‍🎓"}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text)] truncate">{data?.peer?.name || peerEmail}</p>
          <p className="text-xs text-[var(--color-text-muted)] truncate">{peerEmail}</p>
        </div>
      </div>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {error && <p className="text-center text-xs text-red-500">{error}</p>}
        {data && messages.length === 0 && !error && (
          <p className="text-center text-sm text-[var(--color-text-muted)] pt-20">还没有消息，打个招呼开始答疑吧</p>
        )}
        {messages.map((m: any) => {
          const mine = m.sender_email === me;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                mine
                  ? "bg-[var(--color-primary)] text-white rounded-br-md"
                  : "bg-white border border-[var(--color-border)] text-[var(--color-text)] rounded-bl-md"
              }`}>
                <p>{m.body}</p>
                <p className={`text-[10px] mt-1 ${mine ? "text-white/70" : "text-[var(--color-text-muted)]"}`}>
                  {formatTime(m.created_at)}
                  {mine && <span className="ml-2">{m.read_at ? "已读" : "未读"}</span>}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* 输入区（复用全局 ChatInput） */}
      <ChatInput onSend={send} disabled={sending} placeholder="输入你的问题…" />
    </div>
  );
}
