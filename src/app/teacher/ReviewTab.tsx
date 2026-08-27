"use client";

import React, { useState, useEffect, useCallback } from "react";
import { getAuthToken } from "@/contexts/AppContext";
import { formatDate } from "@/lib/task-ui";

const REASON_CLS: Record<string, string> = {
  "内容错误": "bg-red-50 text-red-600",
  "解释不清": "bg-amber-50 text-amber-700",
  "答非所问": "bg-purple-50 text-purple-700",
  "信息不完整": "bg-blue-50 text-blue-700",
  "其他": "bg-gray-100 text-gray-600",
};

export default function ReviewTab() {
  const [items, setItems] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ total: 0, pending: 0, resolved: 0 });
  const [filter, setFilter] = useState<"pending" | "done" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editReason, setEditReason] = useState("");
  const [busy, setBusy] = useState(false);

  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + getAuthToken() };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/ai-review", { headers: { Authorization: "Bearer " + getAuthToken() } });
      if (r.ok) {
        const d = await r.json();
        setItems(d.items || []);
        setStats(d.stats || {});
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (body: any) => {
    setBusy(true);
    try {
      const r = await fetch("/api/ai-review", { method: "POST", headers, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || "操作失败");
      else await load();
    } catch { alert("网络错误"); }
    setBusy(false);
  };

  const filtered = items.filter((i) => filter === "all" ? true : filter === "pending" ? i.status === "pending" : i.status !== "pending");

  return (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-4">
          <div className="text-2xl font-bold text-red-500">{stats.pending}</div>
          <div className="text-xs text-[var(--color-text-muted)] mt-1">待审核</div>
        </div>
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-4">
          <div className="text-2xl font-bold text-green-600">{stats.resolved}</div>
          <div className="text-xs text-[var(--color-text-muted)] mt-1">已修正</div>
        </div>
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-4">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-xs text-[var(--color-text-muted)] mt-1">反馈总数</div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {[
          { k: "pending" as const, l: `待处理（${stats.pending}）` },
          { k: "done" as const, l: "已处理" },
          { k: "all" as const, l: "全部" },
        ].map((f) => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === f.k ? "bg-[var(--color-primary)] text-white" : "bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)]"}`}>
            {f.l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
          <div className="text-4xl mb-3">🛡️</div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {filter === "pending" ? "暂无待审核的 AI 内容反馈" : "暂无记录"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const isExpanded = expanded.has(item.id);
            return (
              <div key={item.id} className="bg-white rounded-xl border border-[var(--color-border)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${REASON_CLS[item.reason] || REASON_CLS["其他"]}`}>
                        {item.reason}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.status === "pending" ? "bg-red-50 text-red-600" : item.status === "resolved" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {item.status === "pending" ? "待审核" : item.status === "resolved" ? "已修正" : "已驳回"}
                      </span>
                      {item.latest_version >= 2 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">已保留 V{item.latest_version}</span>
                      )}
                      <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
                        学生 {String(item.user_email || "").split("@")[0]} · {formatDate(item.created_at)}
                      </span>
                    </div>
                    <p className="text-sm font-semibold mt-2">❓ {item.question}</p>
                  </div>
                </div>

                {item.note && <p className="text-xs text-[var(--color-text-secondary)] mt-2">补充说明：{item.note}</p>}

                <div className={`mt-2.5 text-sm text-[var(--color-text-secondary)] leading-6 bg-gray-50 rounded-lg p-3 ${isExpanded ? "" : "line-clamp-3"}`}>
                  <span className="text-[10px] text-blue-500 mr-1">AI 原回答：</span>
                  {item.answer}
                </div>
                {item.answer?.length > 150 && (
                  <button onClick={() => setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                    return next;
                  })} className="text-xs text-[var(--color-primary)] mt-1 hover:underline">
                    {isExpanded ? "收起" : "展开全文"}
                  </button>
                )}

                {editing === item.id && (
                  <div className="mt-3 rounded-lg border border-[var(--color-border)] p-3">
                    <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1.5">修正内容（保存后原回答保留为 V1）</label>
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={5}
                      className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-y" />
                    <input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="修正原因"
                      className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm mt-2 focus:outline-none" />
                    <div className="flex justify-end gap-2 mt-3">
                      <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs border border-[var(--color-border)] rounded-lg hover:bg-gray-50">取消</button>
                      <button onClick={() => act({ action: "edit", messageId: item.message_id, content: editText, editReason })}
                        disabled={busy || !editText.trim()}
                        className="px-4 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                        保存修正（生成 V2）
                      </button>
                    </div>
                  </div>
                )}

                {item.status === "pending" && editing !== item.id && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => act({ action: "resolve", feedbackId: item.id })} disabled={busy}
                      className="px-3 py-1.5 text-xs rounded-lg bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50">✓ 内容无误，通过</button>
                    <button onClick={() => { setEditing(item.id); setEditText(item.answer); setEditReason(""); }} disabled={busy}
                      className="px-3 py-1.5 text-xs rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50">✏️ 修改</button>
                    <button onClick={() => act({ action: "dismiss", feedbackId: item.id })} disabled={busy}
                      className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-gray-50 disabled:opacity-50">驳回</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
