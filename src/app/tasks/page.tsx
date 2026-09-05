"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/contexts/AppContext";
import { getAuthToken } from "@/contexts/AppContext";
import { TASK_TYPE_META, TASK_STATUS_META, formatDeadline, formatDate } from "@/lib/task-ui";
import type { StudentTaskItem, TeacherFeedbackItem } from "@/types";

const FILTERS: { key: string; label: string }[] = [
  { key: "ALL", label: "全部" },
  { key: "TODO", label: "未开始" },
  { key: "IN_PROGRESS", label: "进行中" },
  { key: "SUBMITTED", label: "待反馈" },
  { key: "REVISION_REQUIRED", label: "需修改" },
  { key: "COMPLETED", label: "已完成" },
  { key: "OVERDUE", label: "已逾期" },
];

export default function TasksPage() {
  const { state } = useApp();
  const router = useRouter();
  const [tab, setTab] = useState<"tasks" | "feedback" | "progress">("tasks");
  const [filter, setFilter] = useState("ALL");
  const [tasks, setTasks] = useState<StudentTaskItem[]>([]);
  const [feedback, setFeedback] = useState<TeacherFeedbackItem[]>([]);
  const [graph, setGraph] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: "Bearer " + getAuthToken() };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, fRes, gRes] = await Promise.all([
        fetch("/api/tasks", { headers }),
        fetch("/api/feedback", { headers }),
        fetch("/api/knowledge-graph", { headers }),
      ]);
      if (tRes.ok) setTasks(await tRes.json());
      if (fRes.ok) setFeedback(await fRes.json());
      if (gRes.ok) setGraph(await gRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.role === "student") load();
  }, [state.role, load]);

  useEffect(() => {
    if (state.authLoading) return;
    if (!state.role) router.replace("/login?redirect=" + encodeURIComponent("/tasks"));
    else if (state.role !== "student") router.replace("/teacher");
  }, [state.authLoading, state.role, router]);

  if (state.authLoading || !state.role || state.role !== "student") {
    return <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">加载中...</div>;
  }

  const pending = tasks.filter((t) => ["TODO", "IN_PROGRESS", "OVERDUE"].includes(t.effective_status)).length;
  const submitted = tasks.filter((t) => t.effective_status === "SUBMITTED").length;
  const revision = tasks.filter((t) => t.effective_status === "REVISION_REQUIRED").length;
  const done = tasks.filter((t) => t.effective_status === "COMPLETED").length;

  const filteredTasks = filter === "ALL" ? tasks : tasks.filter((t) => t.effective_status === filter);
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    const prio: Record<string, number> = { REVISION_REQUIRED: 0, OVERDUE: 1, SUBMITTED: 2, IN_PROGRESS: 3, TODO: 4, COMPLETED: 5 };
    return (prio[a.effective_status] ?? 9) - (prio[b.effective_status] ?? 9);
  });

  // 学习进度（来自真实知识图谱进度，无数据不伪造百分比）
  const nodes: any[] = graph?.nodes || [];
  const masteryOf = (n: any) => Number(n.progress?.mastery ?? 0);
  const studiedOf = (n: any) => Number(n.progress?.studyCount ?? 0);
  const completedNodes = nodes.filter((n) => masteryOf(n) >= 60);
  const studyingNodes = nodes.filter((n) => masteryOf(n) > 0 && masteryOf(n) < 60);
  const notStartedNodes = nodes.filter((n) => masteryOf(n) <= 0 && studiedOf(n) <= 0);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">我的任务</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">老师布置的学习任务、提交状态与教师反馈</p>
      </div>

      {revision > 0 && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 flex items-center gap-3">
          <span className="text-xl">🔔</span>
          <div className="flex-1 text-sm text-red-800">
            你有 <b>{revision}</b> 个任务需要修改后重新提交
          </div>
          <button onClick={() => setFilter("REVISION_REQUIRED")} className="text-sm text-red-700 font-medium hover:underline shrink-0">
            去查看
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          ["⏳", pending, "待完成"],
          ["📤", submitted, "待教师反馈"],
          ["✏️", revision, "需要修改"],
          ["✅", done, "已完成"],
        ].map(([icon, val, label]) => (
          <div key={String(label)} className="bg-white rounded-xl border border-[var(--color-border)] p-4">
            <div className="text-xl mb-1">{icon}</div>
            <div className="text-2xl font-bold">{String(val)}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{String(label)}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {[
          { k: "tasks" as const, l: "📋 任务列表" },
          { k: "feedback" as const, l: "💬 教师反馈" },
          { k: "progress" as const, l: "📈 学习进度" },
        ].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.k ? "bg-white text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"}`}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === "tasks" && (
        <div>
          <div className="flex gap-2 mb-4 flex-wrap">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === f.key ? "bg-[var(--color-primary)] text-white" : "bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]"}`}>
                {f.label}
                {f.key !== "ALL" && <span className="ml-1 opacity-70">{tasks.filter((t) => t.effective_status === f.key).length}</span>}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">加载中...</div>
          ) : sortedTasks.length === 0 ? (
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
              <div className="text-4xl mb-3">🎉</div>
              <p className="text-sm text-[var(--color-text-secondary)]">{filter === "ALL" ? "暂无任务，等待老师布置" : "该状态下暂无任务"}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 gap-4">
              {sortedTasks.map((t) => {
                const typeMeta = TASK_TYPE_META[t.type];
                const statusMeta = TASK_STATUS_META[t.effective_status];
                return (
                  <div key={t.id} onClick={() => router.push(`/tasks/${t.id}`)}
                    className="bg-white rounded-xl border border-[var(--color-border)] p-4 hover:shadow-sm hover:border-[var(--color-primary)] transition-all cursor-pointer">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeMeta.cls}`}>{typeMeta.icon} {typeMeta.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusMeta.cls}`}>{statusMeta.label}</span>
                      {t.class_name && <span className="text-[10px] text-[var(--color-text-muted)]">{t.class_name}</span>}
                    </div>
                    <h3 className="font-semibold text-[var(--color-text)] mt-2.5">{t.title}</h3>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-2">{t.description}</p>
                    <div className="text-[11px] text-[var(--color-text-muted)] mt-2.5 flex items-center justify-between">
                      <span className={t.effective_status === "OVERDUE" ? "text-red-500 font-medium" : ""}>⏰ 截止 {formatDeadline(t.deadline)}</span>
                      <span className="text-[var(--color-primary)]">查看详情 →</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "feedback" && (
        <div>
          {feedback.length === 0 ? (
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
              <div className="text-4xl mb-3">💬</div>
              <p className="text-sm text-[var(--color-text-secondary)]">暂无教师反馈</p>
            </div>
          ) : (
            <div className="space-y-3">
              {feedback.map((f) => (
                <div key={f.id} className={`bg-white rounded-xl border p-4 ${f.status === "revision_required" ? "border-red-200" : "border-[var(--color-border)]"}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TASK_TYPE_META[f.task_type]?.cls || "bg-gray-100 text-gray-600"}`}>
                      {TASK_TYPE_META[f.task_type]?.icon} {TASK_TYPE_META[f.task_type]?.label}
                    </span>
                    <button onClick={() => router.push(`/tasks/${f.task_id}`)} className="text-sm font-semibold text-[var(--color-text)] hover:text-[var(--color-primary)]">
                      {f.task_title}
                    </button>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${f.status === "revision_required" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>
                      {f.status === "revision_required" ? "需要修改" : "已通过"}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">第 {f.submission_version} 版 · {formatDate(f.created_at)}</span>
                  </div>
                  <div className="mt-2.5 bg-gray-50 rounded-lg p-3 text-sm text-[var(--color-text-secondary)] leading-6">
                    <span className="text-xs text-[var(--color-text-muted)] mr-2">👨‍🏫 教师评语：</span>{f.content}
                  </div>
                  {f.status === "revision_required" && (
                    <button onClick={() => router.push(`/tasks/${f.task_id}`)}
                      className="mt-2.5 text-xs text-[var(--color-primary)] font-medium hover:underline">
                      修改并重新提交 →
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "progress" && (
        <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "✅ 已完成", nodes: completedNodes, cls: "bg-green-50", empty: "尚未有知识点达到掌握标准" },
            { label: "📖 正在学习", nodes: studyingNodes, cls: "bg-blue-50", empty: "暂无进行中的知识点" },
            { label: "⬜ 尚未学习", nodes: notStartedNodes, cls: "bg-gray-50", empty: "所有知识点都已开始学习" },
          ].map((g) => (
            <div key={g.label} className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--color-text)]">{g.label}</h3>
                <span className="text-xs text-[var(--color-text-muted)]">{g.nodes.length} 个</span>
              </div>
              <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
                {g.nodes.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)] text-center py-6">{g.empty}</p>
                ) : (
                  g.nodes.map((n: any) => (
                    <div key={n.id} className={`${g.cls} rounded-lg px-3 py-2`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium truncate">{n.name}</span>
                        {g.label.includes("已完成") && n.progress?.mastery != null && (
                          <span className="text-[10px] text-green-700 shrink-0">掌握 {Math.round(n.progress.mastery)}%</span>
                        )}
                      </div>
                      {n.chapter && <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{n.chapter}</div>}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
