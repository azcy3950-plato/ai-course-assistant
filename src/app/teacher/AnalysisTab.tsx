"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getAuthToken } from "@/contexts/AppContext";
import { TASK_TYPE_META, formatDeadline } from "@/lib/task-ui";
import RemedialModal from "./RemedialModal";

export default function AnalysisTab() {
  const router = useRouter();
  const [view, setView] = useState<"nodes" | "students" | "tasks">("nodes");
  const [data, setData] = useState<any>({ nodes: [], tasks: [], students: [] });
  const [loading, setLoading] = useState(true);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [nodeDetail, setNodeDetail] = useState<any[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [remedialOpen, setRemedialOpen] = useState(false);

  const headers = { Authorization: "Bearer " + getAuthToken() };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/analysis", { headers });
      if (r.ok) setData(await r.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleNode = async (nodeId: string) => {
    if (expandedNode === nodeId) {
      setExpandedNode(null);
      setNodeDetail(null);
      return;
    }
    setExpandedNode(nodeId);
    setNodeDetail(null);
    try {
      const r = await fetch(`/api/analysis?nodeId=${encodeURIComponent(nodeId)}`, { headers });
      if (r.ok) setNodeDetail((await r.json()).nodeDetail || []);
    } catch (e) {
      console.error(e);
    }
  };

  const checkAllWeak = (detail: any[]) => {
    setChecked(new Set(detail.filter((d: any) => (Number(d.mastery ?? 0) < 60)).map((d: any) => d.user_email)));
  };

  const masteryColor = (m: number | null) => {
    const v = Number(m ?? 0);
    if (v >= 80) return "bg-green-500";
    if (v >= 60) return "bg-yellow-500";
    return "bg-red-400";
  };

  return (
    <div>
      <p className="text-[10px] text-[var(--color-text-muted)] mb-4">
        数据来自真实学习记录与测验结果；含固定演示账号（student01-12@demo.edu.cn）产生的可复现演示数据
      </p>

      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {[
          { k: "nodes" as const, l: "🏷️ 按知识点" },
          { k: "students" as const, l: "🧑‍🎓 按学生" },
          { k: "tasks" as const, l: "📝 按任务" },
        ].map((t) => (
          <button key={t.k} onClick={() => setView(t.k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === t.k ? "bg-white text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"}`}>
            {t.l}
          </button>
        ))}
        <button onClick={() => router.push("/teacher/quizzes")}
          className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-bg)] transition-colors">
          📊 阶段测验总览 →
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">加载中...</div>
      ) : view === "nodes" ? (
        <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <h3 className="text-sm font-bold">知识点学习情况</h3>
            <span className="text-xs text-[var(--color-text-muted)]">{data.nodes.length} 个知识点有学习数据</span>
          </div>
          {data.nodes.length === 0 ? (
            <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">暂无学情数据，学生开始学习后自动生成</div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {data.nodes.map((n: any) => {
                const acc = n.quiz_total > 0 ? Math.round((n.quiz_correct / n.quiz_total) * 100) : null;
                const mastery = Number(n.avg_mastery ?? 0);
                return (
                  <div key={n.id}>
                    <button onClick={() => toggleNode(n.id)} className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 text-left">
                      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${masteryColor(mastery)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[var(--color-text)] truncate">{n.name}</div>
                        <div className="text-[10px] text-[var(--color-text-muted)]">{n.chapter || "未分类"} · {n.student_count} 名学生</div>
                      </div>
                      <div className="w-40 shrink-0 hidden md:block">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-100 rounded-full h-2">
                            <div className={`h-2 rounded-full ${masteryColor(mastery)}`} style={{ width: `${Math.min(100, mastery)}%` }} />
                          </div>
                          <span className="text-[10px] text-[var(--color-text-muted)] w-12 text-right">{mastery}%</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 w-24 text-right">
                        练习 {n.quiz_correct}/{n.quiz_total}{acc !== null && `（${acc}%）`}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 w-16 text-right">{n.related_tasks} 任务</span>
                      <span className="text-[var(--color-text-muted)] text-xs shrink-0">{expandedNode === n.id ? "▲" : "▼"}</span>
                    </button>
                    {expandedNode === n.id && (
                      <div className="bg-gray-50 px-5 py-4 border-t border-[var(--color-border)]">
                        {nodeDetail === null ? (
                          <div className="text-xs text-[var(--color-text-muted)] py-3 text-center">加载中...</div>
                        ) : nodeDetail.length === 0 ? (
                          <div className="text-xs text-[var(--color-text-muted)] py-3 text-center">暂无学生明细</div>
                        ) : (
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <button onClick={() => checkAllWeak(nodeDetail)} className="text-xs text-[var(--color-primary)] hover:underline">勾选掌握度 &lt; 60% 的学生</button>
                              <span className="text-[10px] text-[var(--color-text-muted)]">已选 {checked.size} 人</span>
                              {checked.size > 0 && (
                                <button onClick={() => setRemedialOpen(true)}
                                  className="text-xs px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 ml-auto">
                                  布置补充学习（{checked.size} 人）
                                </button>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              {nodeDetail.map((d: any) => {
                                const m = Number(d.mastery ?? 0);
                                return (
                                  <label key={d.user_email} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 cursor-pointer hover:border-[var(--color-primary)] border border-transparent">
                                    <input type="checkbox" checked={checked.has(d.user_email)}
                                      onChange={(e) => setChecked((prev) => {
                                        const next = new Set(prev);
                                        if (e.target.checked) next.add(d.user_email); else next.delete(d.user_email);
                                        return next;
                                      })} className="accent-[var(--color-primary)]" />
                                    <span className="text-xs font-medium w-20 truncate">{d.name || d.user_email.split("@")[0]}</span>
                                    <div className="flex-1 bg-gray-100 rounded-full h-1.5 max-w-[160px]">
                                      <div className={`h-1.5 rounded-full ${masteryColor(m)}`} style={{ width: `${Math.min(100, m)}%` }} />
                                    </div>
                                    <span className="text-[10px] text-[var(--color-text-muted)] w-24">掌握 {m}% · 练习 {d.quiz_correct}/{d.quiz_total}</span>
                                    <button onClick={() => router.push(`/teacher/students/${encodeURIComponent(d.user_email)}`)}
                                      className="text-[10px] text-[var(--color-primary)] hover:underline ml-auto">学生详情 →</button>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : view === "students" ? (
        <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-bold">学生概览（{data.students.length} 人）</h3>
          </div>
          {data.students.length === 0 ? (
            <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">暂无学生，请先在「班级与学生」中添加</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-gray-50">
                  {["学生", "班级", "任务完成", "错题", "最近活动", ""].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.students.map((s: any) => (
                    <tr key={s.user_email} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{s.name || s.user_email.split("@")[0]}</td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">{s.class_names || "—"}</td>
                      <td className="px-4 py-3 text-xs">{s.task_done}/{s.task_total}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className={Number(s.quiz_wrong) > 0 ? "text-red-500" : "text-green-600"}>{s.quiz_wrong} 题</span>
                        {s.quiz_total > 0 && <span className="text-[var(--color-text-muted)]">/{s.quiz_total}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {s.last_active ? new Date(s.last_active).toLocaleDateString("zh-CN") : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => router.push(`/teacher/students/${encodeURIComponent(s.user_email)}`)}
                          className="text-xs text-[var(--color-primary)] hover:underline">查看详情 →</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {data.tasks.length === 0 ? (
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-10 text-center text-sm text-[var(--color-text-muted)]">暂无任务</div>
          ) : (
            data.tasks.map((t: any) => {
              const meta = TASK_TYPE_META[t.type as keyof typeof TASK_TYPE_META];
              const total = Number(t.total || 0);
              const done = Number(t.done || 0);
              return (
                <div key={t.id} onClick={() => router.push(`/teacher/tasks/${t.id}`)}
                  className="bg-white rounded-xl border border-[var(--color-border)] p-4 hover:border-[var(--color-primary)] transition-colors cursor-pointer">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.icon} {meta.label}</span>
                    <span className="text-sm font-semibold">{t.title}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">⏰ {formatDeadline(t.deadline)}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-3">
                    <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                      <div className="bg-[var(--color-primary)] h-2.5 rounded-full" style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }} />
                    </div>
                    <span className="text-xs text-[var(--color-text-secondary)] shrink-0">{done}/{total} 完成 · 待批 {t.submitted} · 需修改 {t.revision} · 逾期 {t.overdue}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {remedialOpen && (
        <RemedialModal open={remedialOpen} onClose={() => setRemedialOpen(false)} targetEmails={[...checked]}
          onCreated={() => { setChecked(new Set()); load(); }} />
      )}
    </div>
  );
}
