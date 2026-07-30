"use client";

import React, { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface Props {
  intensity: number;
  duration: number;
  maxDepth: number;
  floodArea: number;
}

const shortcuts = [
  "📍 定位最深积水区",
  "🌧️ 分析积水原因",
  "🔧 有什么改进方案",
  "📊 解释当前结果",
];

export default function AIChat({ intensity, duration, maxDepth, floodArea }: Props) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgs, setMsgs] = useState<{ role: string; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    setMsgs(prev => [...prev, { role: "user", content: text }]);
    setMsg("");
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (data.session?.access_token || "") },
        body: JSON.stringify({ action: "sandbox", params: { question: text, simulation: { intensity, duration, maxDepth, floodArea } } }),
      });
      const j = await res.json();
      setMsgs(prev => [...prev, { role: "assistant", content: j.answer || "分析中..." }]);
    } catch { setMsgs(prev => [...prev, { role: "assistant", content: "AI暂时不可用" }]); }
    finally { setLoading(false); }
  };

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-[var(--color-primary)] text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center text-2xl">
          💬
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-96 h-[500px] bg-white rounded-2xl shadow-2xl border border-[var(--color-border)] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-[var(--color-primary)] text-white">
            <span className="text-sm font-bold">🤖 沙盘 AI 助手</span>
            <button onClick={() => setOpen(false)} className="text-white hover:opacity-70">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {msgs.length === 0 && (
              <div>
                <p className="text-sm text-[var(--color-text-secondary)] mb-3">我可以帮你分析模拟结果，试试这些：</p>
                <div className="flex flex-wrap gap-2">
                  {shortcuts.map(s => (
                    <button key={s} onClick={() => send(s)} className="text-xs px-3 py-1.5 bg-blue-50 text-[var(--color-primary)] rounded-full hover:bg-blue-100 transition-colors">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={"text-sm " + (m.role === "user" ? "text-right" : "")}>
                <div className={"inline-block max-w-[85%] rounded-xl px-3 py-2 " + (m.role === "user" ? "bg-[var(--color-primary)] text-white" : "bg-gray-100 text-[var(--color-text)]")}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && <div className="text-xs text-[var(--color-text-muted)]">分析中...</div>}
            <div ref={endRef} />
          </div>

          <div className="p-3 border-t">
            <div className="flex gap-2">
              <input value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === "Enter" && send(msg)}
                placeholder="输入问题..." className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]" />
              <button onClick={() => send(msg)} disabled={loading}
                className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50">发送</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
