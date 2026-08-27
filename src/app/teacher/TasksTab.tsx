"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getAuthToken } from "@/contexts/AppContext";
import { TASK_TYPE_META, formatDeadline } from "@/lib/task-ui";

const TASK_TYPES = [
  { k: "KNOWLEDGE", l: "📚 知识学习任务", hint: "关联知识点，学生去知识问答学习" },
  { k: "PRACTICE", l: "✏️ 练习任务", hint: "教师出题，学生在线作答" },
  { k: "GUIDED", l: "💡 引导学习任务", hint: "学生去引导学习完成探究" },
  { k: "SIMULATION", l: "🗺️ 仿真分析任务", hint: "学生去电子沙盘做实验并提交结论" },
];

interface PQ { q: string; options: string[]; answer: string; explanation: string; }

export default function TasksTab() {
  const router = useRouter();
  const [tasks, setTasks] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [graphNodes, setGraphNodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  // 表单
  const [title, setTitle] = useState("");
  const [type, setType] = useState("KNOWLEDGE");
  const [classId, setClassId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [description, setDescription] = useState("");
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [observeText, setObserveText] = useState("");
  const [promptText, setPromptText] = useState("");
  const [pqs, setPqs] = useState<PQ[]>([{ q: "", options: ["", "", "", ""], answer: "", explanation: "" }]);

  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + getAuthToken() };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, cRes, gRes] = await Promise.all([
        fetch("/api/tasks", { headers: { Authorization: "Bearer " + getAuthToken() } }),
        fetch("/api/classes", { headers: { Authorization: "Bearer " + getAuthToken() } }),
        fetch("/api/knowledge-graph", { headers: { Authorization: "Bearer " + getAuthToken() } }),
      ]);
      if (tRes.ok) setTasks(await tRes.json());
      if (cRes.ok) setClasses(await cRes.json());
      if (gRes.ok) setGraphNodes((await gRes.json()).nodes || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!title.trim()) { alert("请填写任务标题"); return; }
    if (!classId) { alert("请选择目标班级"); return; }
    let questions: any[] = [];
    if (type === "PRACTICE") {
      for (const [i, p] of pqs.entries()) {
        const filledOpts = p.options.map((o) => o.trim()).filter(Boolean);
        if (!p.q.trim() || filledOpts.length < 2) { alert(`第 ${i + 1} 题需要题目和至少两个选项`); return; }
        if (!filledOpts.includes(p.answer)) { alert(`第 ${i + 1} 题的正确答案必须来自选项`); return; }
        questions.push({ q: p.q.trim(), options: filledOpts, answer: p.answer, explanation: p.explanation.trim() });
      }
    }
    const observeItems = type === "SIMULATION" ? observeText.split("\n").map((s) => s.trim()).filter(Boolean) : [];
    const promptQuestions = type === "SIMULATION" ? promptText.split("\n").map((s) => s.trim()).filter(Boolean) : [];
    if (type === "SIMULATION" && (observeItems.length === 0 || promptQuestions.length === 0)) {
      alert("仿真任务需要填写观察指标和需要回答的问题（每行一条）"); return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers,
        body: JSON.stringify({
          title: title.trim(), description: description.trim(), type,
          classId: Number(classId), deadline: deadline ? new Date(deadline).toISOString() : null,
          knowledgeNodeIds: type === "KNOWLEDGE" ? nodeIds : [],
          questions, observeItems, promptQuestions,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) alert(data.error || "创建失败");
      else {
        setShowForm(false);
        setTitle(""); setDescription(""); setDeadline(""); setNodeIds([]); setObserveText(""); setPromptText("");
        setPqs([{ q: "", options: ["", "", "", ""], answer: "", explanation: "" }]);
        await load();
      }
    } catch { alert("网络错误"); }
    setBusy(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">共 {tasks.length} 个任务</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90">
          {showForm ? "收起表单" : "+ 新建任务"}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-5 mb-6">
          <h3 className="text-sm font-bold mb-4">📝 创建学习任务</h3>
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">任务标题 *</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：城市排水系统基础"
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">目标班级 *</label>
                <select value={classId} onChange={(e) => setClassId(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none">
                  <option value="">选择班级</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.member_count} 人）</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">任务类型</label>
                <select value={type} onChange={(e) => setType(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none">
                  {TASK_TYPES.map((t) => <option key={t.k} value={t.k}>{t.l}</option>)}
                </select>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{TASK_TYPES.find((t) => t.k === type)?.hint}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">截止时间</label>
                <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">任务说明</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                placeholder="告诉学生任务要求和完成标准"
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-y" />
            </div>

            {type === "KNOWLEDGE" && (
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">关联知识点（最多 8 个）</label>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {graphNodes.slice(0, 60).map((n) => {
                    const on = nodeIds.includes(n.id);
                    return (
                      <button key={n.id} onClick={() => setNodeIds((prev) =>
                        on ? prev.filter((x) => x !== n.id) : prev.length >= 8 ? prev : [...prev, n.id])}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${on ? "border-[var(--color-primary)] bg-[var(--color-primary-bg)] text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-gray-300"}`}>
                        {n.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {type === "PRACTICE" && (
              <div className="space-y-4">
                {pqs.map((p, i) => (
                  <div key={i} className="rounded-lg border border-[var(--color-border)] p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">第 {i + 1} 题</span>
                      {pqs.length > 1 && (
                        <button onClick={() => setPqs((prev) => prev.filter((_, j) => j !== i))}
                          className="text-[10px] text-red-500 hover:underline">删除</button>
                      )}
                    </div>
                    <input value={p.q} onChange={(e) => setPqs((prev) => prev.map((x, j) => j === i ? { ...x, q: e.target.value } : x))}
                      placeholder="题目" className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none" />
                    <div className="grid grid-cols-2 gap-2">
                      {p.options.map((o, k) => (
                        <input key={k} value={o} onChange={(e) => setPqs((prev) => prev.map((x, j) => j === i ? { ...x, options: x.options.map((y, m) => m === k ? e.target.value : y) } : x))}
                          placeholder={`选项 ${String.fromCharCode(65 + k)}`} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none" />
                      ))}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--color-text-secondary)]">正确答案：</span>
                      <select value={p.answer} onChange={(e) => setPqs((prev) => prev.map((x, j) => j === i ? { ...x, answer: e.target.value } : x))}
                        className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none">
                        <option value="">选择</option>
                        {p.options.filter((o) => o.trim()).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <input value={p.explanation} onChange={(e) => setPqs((prev) => prev.map((x, j) => j === i ? { ...x, explanation: e.target.value } : x))}
                        placeholder="解析（可选）" className="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none" />
                    </div>
                  </div>
                ))}
                <button onClick={() => setPqs((prev) => [...prev, { q: "", options: ["", "", "", ""], answer: "", explanation: "" }])}
                  className="text-xs text-[var(--color-primary)] hover:underline">+ 添加题目</button>
              </div>
            )}

            {type === "SIMULATION" && (
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">需要观察的指标（每行一条）</label>
                  <textarea value={observeText} onChange={(e) => setObserveText(e.target.value)} rows={4}
                    placeholder={"最大水深\n峰值流量\n满管情况"}
                    className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-y" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">需要回答的问题（每行一条）</label>
                  <textarea value={promptText} onChange={(e) => setPromptText(e.target.value)} rows={4}
                    placeholder={"你观察到什么？\n为什么出现这种结果？\n你会如何调整方案？"}
                    className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-y" />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] hover:bg-gray-50">取消</button>
              <button onClick={submit} disabled={busy}
                className="px-5 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                {busy ? "创建中..." : "创建任务"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">加载中...</div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
          <div className="text-4xl mb-3">📝</div>
          <p className="text-sm text-[var(--color-text-secondary)]">还没有任务，点击「新建任务」布置第一个学习任务</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => {
            const meta = TASK_TYPE_META[t.type as keyof typeof TASK_TYPE_META];
            const total = Number(t.total || 0);
            const done = Number(t.done || 0);
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <div key={t.id} onClick={() => router.push(`/teacher/tasks/${t.id}`)}
                className="bg-white rounded-xl border border-[var(--color-border)] p-4 hover:border-[var(--color-primary)] transition-colors cursor-pointer">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.icon} {meta.label}</span>
                  <span className="text-sm font-semibold text-[var(--color-text)]">{t.title}</span>
                  {t.class_name && <span className="text-[10px] text-[var(--color-text-muted)]">{t.class_name}</span>}
                  <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">⏰ {formatDeadline(t.deadline)}</span>
                </div>
                <div className="flex items-center gap-4 mt-3">
                  <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                    <div className="bg-[var(--color-primary)] h-2.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-[var(--color-text-secondary)] shrink-0">{done}/{total} 完成</span>
                </div>
                <div className="flex gap-3 mt-2 text-[10px] text-[var(--color-text-muted)]">
                  <span>📤 待批阅 {t.submitted || 0}</span>
                  <span>✏️ 需修改 {t.revision || 0}</span>
                  <span>⏳ 进行中 {t.in_progress || 0}</span>
                  <span className={Number(t.overdue || 0) > 0 ? "text-red-500 font-medium" : ""}>⚠️ 已逾期 {t.overdue || 0}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
