"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/contexts/AppContext";
import { getAuthToken } from "@/contexts/AppContext";
import RemedialModal from "../../RemedialModal";

export default function ClassDetailPage() {
  const { state } = useApp();
  const router = useRouter();
  const params = useParams();
  const id = Number(params.id);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + getAuthToken() };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/classes/${id}`, { headers: { Authorization: "Bearer " + getAuthToken() } });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "加载失败");
        return;
      }
      setData(await r.json());
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { if (state.role === "teacher") load(); }, [state.role, load]);

  const addMember = async () => {
    if (!addEmail.trim()) { alert("请输入学生注册邮箱"); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/classes/${id}/members`, { method: "POST", headers, body: JSON.stringify({ email: addEmail.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || "添加失败");
      else { setAddEmail(""); await load(); }
    } catch { alert("网络错误"); }
    setBusy(false);
  };

  const removeMember = async (email: string) => {
    if (!confirm(`将学生 ${email.split("@")[0]} 移出班级？`)) return;
    try {
      await fetch(`/api/classes/${id}/members`, { method: "DELETE", headers, body: JSON.stringify({ email }) });
      await load();
    } catch { alert("删除失败"); }
  };

  if (state.authLoading || loading) {
    return <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">加载中...</div>;
  }
  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">{error}</p>
        <button onClick={() => router.push("/teacher")} className="text-sm text-[var(--color-primary)] hover:underline">返回教学管理</button>
      </div>
    );
  }
  if (!data) return null;

  const students: any[] = data.students || [];
  const doneTotal = students.reduce((s, st) => s + (st.task_done || 0), 0);
  const taskTotal = students.reduce((s, st) => s + (st.task_total || 0), 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <button onClick={() => router.push("/teacher")} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] mb-4">
        ← 返回教学管理
      </button>

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">🏫 {data.cls.name}</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {students.length} 名学生 · 任务完成 {doneTotal}/{taskTotal}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setChecked(new Set()); setModalOpen(true); }}
            className="px-4 py-2 text-sm border border-[var(--color-primary)] text-[var(--color-primary)] rounded-lg hover:bg-[var(--color-primary-bg)]">
            ✏️ 勾选学生布置补充学习
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        <input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="输入学生注册邮箱添加进班级"
          onKeyDown={(e) => e.key === "Enter" && addMember()}
          className="flex-1 max-w-sm rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
        <button onClick={addMember} disabled={busy}
          className="px-4 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
          + 添加学生
        </button>
      </div>

      <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="text-sm font-bold">学生名单</h3>
          <span className="text-xs text-[var(--color-text-muted)]">已选 {checked.size} 人</span>
        </div>
        {students.length === 0 ? (
          <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">班级还没有学生，用上方输入框添加</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50">
                {["", "学生", "任务完成", "错题", "最近活动", ""].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {students.map((st) => (
                  <tr key={st.user_email} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 w-10">
                      <input type="checkbox" checked={checked.has(st.user_email)}
                        onChange={(e) => setChecked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(st.user_email); else next.delete(st.user_email);
                          return next;
                        })} className="accent-[var(--color-primary)]" />
                    </td>
                    <td className="px-4 py-3 font-medium">{st.name || st.user_email.split("@")[0]}</td>
                    <td className="px-4 py-3 text-xs">{st.task_done || 0}/{st.task_total || 0}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={Number(st.quiz_wrong) > 0 ? "text-red-500" : "text-green-600"}>{st.quiz_wrong || 0} 题</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                      {st.last_active ? new Date(st.last_active).toLocaleDateString("zh-CN") : "—"}
                    </td>
                    <td className="px-4 py-3 text-right space-x-3">
                      <button onClick={() => router.push(`/teacher/students/${encodeURIComponent(st.user_email)}`)}
                        className="text-xs text-[var(--color-primary)] hover:underline">学生详情 →</button>
                      <button onClick={() => removeMember(st.user_email)}
                        className="text-xs text-[var(--color-text-muted)] hover:text-red-500">移出</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && checked.size > 0 && (
        <RemedialModal open={modalOpen} onClose={() => setModalOpen(false)} targetEmails={[...checked]}
          onCreated={() => { setChecked(new Set()); load(); }} />
      )}
    </div>
  );
}
