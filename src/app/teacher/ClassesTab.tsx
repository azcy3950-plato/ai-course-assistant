"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getAuthToken } from "@/contexts/AppContext";

export default function ClassesTab() {
  const router = useRouter();
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + getAuthToken() };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/classes", { headers: { Authorization: "Bearer " + getAuthToken() } });
      if (r.ok) setClasses(await r.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim()) { alert("请输入班级名称"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/classes", { method: "POST", headers, body: JSON.stringify({ name: name.trim() }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) alert(data.error || "创建失败");
      else { setName(""); await load(); }
    } catch { alert("网络错误"); }
    setBusy(false);
  };

  const remove = async (id: number) => {
    if (!confirm("删除班级会移除所有成员关系，确定删除？")) return;
    try {
      await fetch(`/api/classes/${id}`, { method: "DELETE", headers: { Authorization: "Bearer " + getAuthToken() } });
      await load();
    } catch { alert("删除失败"); }
  };

  const totalStudents = classes.reduce((s, c) => s + (c.member_count || 0), 0);

  return (
    <div>
      <p className="text-[10px] text-[var(--color-text-muted)] mb-4">
        注：当前为演示环境，学生均为匿名演示账号（演示数据）
      </p>

      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-4">
          <div className="text-2xl font-bold">{classes.length}</div>
          <div className="text-xs text-[var(--color-text-muted)] mt-1">我的班级</div>
        </div>
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-4">
          <div className="text-2xl font-bold">{totalStudents}</div>
          <div className="text-xs text-[var(--color-text-muted)] mt-1">班级学生总数</div>
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新班级名称，如：排水231班"
          onKeyDown={(e) => e.key === "Enter" && create()}
          className="flex-1 max-w-xs rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
        <button onClick={create} disabled={busy}
          className="px-4 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
          + 新建班级
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">加载中...</div>
      ) : classes.length === 0 ? (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
          <div className="text-4xl mb-3">🏫</div>
          <p className="text-sm text-[var(--color-text-secondary)]">还没有班级，先创建一个班级并添加学生</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {classes.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-[var(--color-border)] p-4 flex items-center gap-4">
              <span className="text-3xl">🏫</span>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-[var(--color-text)]">{c.name}</h3>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  {c.member_count || 0} 名学生 · 创建于 {new Date(c.created_at).toLocaleDateString("zh-CN")}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => router.push(`/teacher/classes/${c.id}`)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90">
                  学生与任务
                </button>
                <button onClick={() => remove(c.id)} className="text-xs text-[var(--color-text-muted)] hover:text-red-500">删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
