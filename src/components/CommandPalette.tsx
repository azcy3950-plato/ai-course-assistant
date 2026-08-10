"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/contexts/AppContext";

const studentCommands = [
  { label: "知识问答", icon: "💬", href: "/knowledge" },
  { label: "引导学习", icon: "🧭", href: "/guided" },
  { label: "学习洞察", icon: "📊", href: "/insights" },
  { label: "学习画像", icon: "🎯", href: "/portrait" },
  { label: "学习总结", icon: "📋", href: "/summary" },
  { label: "电子沙盘", icon: "🗺️", href: "/sandbox" },
  { label: "学习记录", icon: "📝", href: "/records" },
];

const teacherCommands = [
  { label: "教师工作台", icon: "🏫", href: "/teacher" },
  { label: "文档管理", icon: "📤", href: "/teacher?tab=upload" },
  { label: "检索测试", icon: "🔍", href: "/teacher/search" },
  { label: "知识问答", icon: "💬", href: "/knowledge" },
  { label: "引导学习", icon: "🧭", href: "/guided" },
  { label: "电子沙盘", icon: "🗺️", href: "/sandbox" },
];

export default function CommandPalette() {
  const router = useRouter();
  const { state, darkMode, toggleDarkMode } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const commands = state.role === "teacher" ? teacherCommands : studentCommands;
  const filtered = commands.filter(c => c.label.includes(query));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "p" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        setOpen(prev => !prev);
        setQuery("");
        setSelected(0);
      }
      if (e.key === "Escape") setOpen(false);
      if (open) {
        if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, Math.max(0, filtered.length - 1))); }
        if (e.key === "ArrowUp") { e.preventDefault(); setSelected(s => Math.max(0, s - 1)); }
        if (e.key === "Enter") {
          e.preventDefault();
          const cmd = filtered[selected] || filtered[0];
          if (cmd) { router.push(cmd.href); setOpen(false); }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, filtered, selected, router]);

  if (!open || !state.role) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-[var(--color-border)] w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b">
          <span className="text-lg">🔍</span>
          <input
            autoFocus
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0); }}
            placeholder="搜索页面... （Ctrl+K 打开）"
            className="flex-1 text-base bg-transparent outline-none text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-[var(--color-text-muted)] font-mono">ESC</kbd>
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-[var(--color-text-muted)]">无匹配结果</div>
          ) : filtered.map((cmd, i) => (
            <button
              key={cmd.href}
              onClick={() => { router.push(cmd.href); setOpen(false); }}
              className={"w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors " + (i === selected ? "bg-[var(--color-primary-bg)] text-[var(--color-primary)]" : "hover:bg-gray-50 text-[var(--color-text)]")}
            >
              <span className="text-lg w-7 text-center">{cmd.icon}</span>
              <span className="text-sm font-medium">{cmd.label}</span>
              <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">↵</span>
            </button>
          ))}
        </div>
        <div className="px-5 py-3 border-t flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
          <span>↑↓ 切换 · ↵ 打开 · ESC 关闭</span>
          <button onClick={toggleDarkMode} className="hover:text-[var(--color-primary)]">{darkMode ? "☀️ 浅色" : "🌙 深色"}</button>
        </div>
      </div>
    </div>
  );
}
