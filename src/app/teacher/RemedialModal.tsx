"use client";

import React, { useState } from "react";
import { getAuthToken } from "@/contexts/AppContext";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  targetEmails: string[];
  presetTitle?: string;
}

const TYPES = [
  { k: "KNOWLEDGE", l: "📚 重新学习知识点" },
  { k: "PRACTICE", l: "✏️ 专项练习" },
  { k: "GUIDED", l: "💡 再做一次引导学习" },
  { k: "SIMULATION", l: "🗺️ 重新完成仿真反思" },
  { k: "REMEDIAL", l: "🔁 其他补充学习" },
];

/** 布置补充学习：本质是创建 REMEDIAL 任务（或携带具体类型的补充任务） */
export default function RemedialModal({ open, onClose, onCreated, targetEmails, presetTitle }: Props) {
  const [type, setType] = useState("KNOWLEDGE");
  const [title, setTitle] = useState(presetTitle || "");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);

  // 专项练习（单题）
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState(["", "", "", ""]);
  const [answer, setAnswer] = useState("");
  const [expl, setExpl] = useState("");

  if (!open) return null;

  const submit = async () => {
    if (!title.trim()) { alert("请填写任务标题"); return; }
    let questions: any[] = [];
    if (type === "PRACTICE") {
      const filledOpts = opts.map((o) => o.trim()).filter(Boolean);
      if (!q.trim() || filledOpts.length < 2) { alert("练习需要题目和至少两个选项"); return; }
      if (!filledOpts.includes(answer)) { alert("正确答案必须来自选项"); return; }
      questions = [{ q: q.trim(), options: filledOpts, answer, explanation: expl.trim() }];
    }
    setBusy(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getAuthToken() },
        body: JSON.stringify({
          title: title.trim(), description: description.trim(), type,
          targetEmails, deadline: deadline ? new Date(deadline).toISOString() : null,
          questions,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) alert(data.error || "创建失败");
      else {
        onCreated?.();
        onClose();
        setTitle(""); setDescription(""); setDeadline(""); setQ(""); setOpts(["", "", "", ""]); setAnswer(""); setExpl("");
      }
    } catch {
      alert("网络错误");
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[var(--color-text)] mb-1">布置补充学习</h3>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          目标学生：<b className="text-[var(--color-primary)]">{targetEmails.length}</b> 人
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">学习内容</label>
            <div className="flex flex-wrap gap-2">
              {TYPES.map((t) => (
                <button key={t.k} onClick={() => setType(t.k)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${type === t.k ? "border-[var(--color-primary)] bg-[var(--color-primary-bg)] text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-gray-300"}`}>
                  {t.l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">任务标题 *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：排水体制知识点复习"
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">任务说明</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              placeholder="告诉学生要做什么、做到什么程度"
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-y" />
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">截止时间</label>
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)}
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
          </div>

          {type === "PRACTICE" && (
            <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
              <p className="text-xs font-semibold text-[var(--color-text)]">✏️ 练习题（1 题）</p>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="题目"
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
              {opts.map((o, i) => (
                <input key={i} value={o} onChange={(e) => setOpts((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder={`选项 ${String.fromCharCode(65 + i)}`}
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
              ))}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-text-secondary)]">正确答案：</span>
                <select value={answer} onChange={(e) => setAnswer(e.target.value)}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none">
                  <option value="">选择选项</option>
                  {opts.filter((o) => o.trim()).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <input value={expl} onChange={(e) => setExpl(e.target.value)} placeholder="解析（可选）"
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] hover:bg-gray-50">取消</button>
          <button onClick={submit} disabled={busy}
            className="px-5 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
            {busy ? "创建中..." : "创建任务"}
          </button>
        </div>
      </div>
    </div>
  );
}
