"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useApp, getAuthToken } from "@/contexts/AppContext";

function maskEmail(email: string): string {
  const [u, d] = String(email).split("@");
  return `${u.slice(0, 1)}***@${d}`;
}

export default function AdminPage() {
  const { state } = useApp();
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: "Bearer " + getAuthToken() },
      });
      if (r.ok) setUsers((await r.json()).users || []);
      else if (r.status === 403) router.replace("/");
    } catch (e) { /* 静默 */ }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => { if (state.role === "admin") load(); }, [state.role, load]);

  useEffect(() => {
    if (state.authLoading) return;
    if (!state.role) router.replace("/login?redirect=" + encodeURIComponent("/admin"));
    else if (state.role !== "admin") router.replace("/");
  }, [state.authLoading, state.role, router]);

  const changeRole = async (email: string, role: string) => {
    setBusy(email);
    try {
      const r = await fetch("/api/admin/role", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getAuthToken() },
        body: JSON.stringify({ email, role }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setMsg({ ok: true, text: `${maskEmail(email)} 已${role === "teacher" ? "授予" : "取消"}教师角色` }); await load(); }
      else setMsg({ ok: false, text: d.error || "操作失败" });
    } catch { setMsg({ ok: false, text: "网络错误" }); }
    setBusy(null);
  };

  const deleteAccount = async (email: string) => {
    if (!confirm(`停用账号 ${maskEmail(email)}？该账号将无法登录（数据保留）。`)) return;
    setBusy(email);
    try {
      const r = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + getAuthToken() },
        body: JSON.stringify({ email }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setMsg({ ok: true, text: `${maskEmail(email)} 已停用` }); await load(); }
      else setMsg({ ok: false, text: d.error || "操作失败" });
    } catch { setMsg({ ok: false, text: "网络错误" }); }
    setBusy(null);
  };

  if (state.authLoading || (state.role && state.role !== "admin")) {
    return <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">加载中...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">🔐 账号管理（Admin）</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">授予/取消教师角色、停用账号——所有操作写入审计日志</p>
      </div>

      <div className="flex gap-2 mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="按姓名或邮箱搜索"
          className="flex-1 max-w-xs rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
        <button onClick={() => load()} className="px-4 py-2 text-sm border border-[var(--color-border)] rounded-lg hover:bg-gray-50">刷新</button>
      </div>

      {msg && <p className={`text-xs mb-3 ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</p>}

      <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">加载中...</div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">没有匹配的账号</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">
              {["姓名", "邮箱", "角色", "状态", "最近登录", "操作"].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-secondary)]">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">{u.name}</td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-text-secondary)]">{maskEmail(u.email)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.role === "admin" ? "bg-purple-50 text-purple-700" : u.role === "teacher" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                      {u.role === "admin" ? "管理员" : u.role === "teacher" ? "教师" : "学生"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {u.status === "disabled" ? <span className="text-red-500">已停用</span> : <span className="text-green-600">正常</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                    {u.last_login ? new Date(u.last_login).toLocaleDateString("zh-CN") : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2">
                      {u.role === "teacher" ? (
                        <button onClick={() => changeRole(u.email, "student")} disabled={busy === u.email}
                          className="text-xs px-2 py-1 rounded border border-[var(--color-border)] hover:bg-gray-50 disabled:opacity-50">取消教师</button>
                      ) : u.role === "student" ? (
                        <button onClick={() => changeRole(u.email, "teacher")} disabled={busy === u.email}
                          className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:opacity-90 disabled:opacity-50">授予教师</button>
                      ) : null}
                      {u.role !== "admin" && (
                        <button onClick={() => deleteAccount(u.email)} disabled={busy === u.email}
                          className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">停用</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
