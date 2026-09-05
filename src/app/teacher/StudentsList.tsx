"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getAuthToken } from "@/contexts/AppContext";

function maskEmail(email: string): string {
  const [u, d] = String(email).split("@");
  return `${u.slice(0, 1)}***@${d}`;
}

/** 全班学生数据视图（并入"班级"）。教师可改名/查看记录；重置密码与删除账号已收归 Admin。 */
export default function StudentsList() {
  const router = useRouter();
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/students", {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
      });
      if (res.ok) setStudents((await res.json()).students || []);
    } catch (e) { /* 静默 */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const rename = async (email: string) => {
    if (!editName.trim()) return;
    setBusyEmail(email);
    try {
      const res = await fetch("/api/admin/student", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ email, name: editName.trim() }),
      });
      if (res.ok) { setEditingEmail(null); setMsg("姓名已更新"); await load(); }
      else setMsg("更新失败");
    } catch { setMsg("网络错误"); }
    setBusyEmail(null);
  };

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-[var(--color-text)]">👥 学生统计（全部班级）</h3>
        <button onClick={load} className="text-xs text-[var(--color-primary)] hover:underline">🔄 刷新</button>
      </div>
      {msg && <p className="text-xs text-green-600 mb-2">{msg}</p>}
      <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">加载中…</div>
        ) : students.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">暂无注册学生</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50">
                {["姓名", "邮箱", "问答", "小测/正确率", "最近活跃", "操作"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {students.map((stu) => (
                  <tr key={stu.email} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">
                      {editingEmail === stu.email ? (
                        <span className="flex items-center gap-1">
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={30}
                            className="w-24 border border-gray-300 rounded px-1.5 py-0.5 text-xs" />
                          <button onClick={() => rename(stu.email)} disabled={busyEmail === stu.email}
                            className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded">存</button>
                          <button onClick={() => setEditingEmail(null)} className="text-[10px] px-1.5 py-0.5 bg-gray-200 rounded">✕</button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          {stu.name}
                          <button title="修改姓名" onClick={() => { setEditingEmail(stu.email); setEditName(stu.name); }}
                            className="text-[10px] text-blue-500 hover:text-blue-700">✏️</button>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">{maskEmail(stu.email)}</td>
                    <td className="px-3 py-2 text-xs">{stu.queryCount}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`px-2 py-0.5 rounded-full font-medium text-[10px] ${stu.quizRate >= 70 ? "bg-green-100 text-green-700" : stu.quizRate >= 40 ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"}`}>
                        {stu.quizTotal} 次 · {stu.quizRate}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                      {stu.lastActive ? new Date(stu.lastActive).toLocaleDateString("zh-CN") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => router.push(`/teacher/students/${encodeURIComponent(stu.email)}`)}
                        className="text-[10px] px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded">📋 学习详情</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
