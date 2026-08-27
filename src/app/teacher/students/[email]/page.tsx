"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApp, getAuthToken } from "@/contexts/AppContext";
import { TASK_TYPE_META, TASK_STATUS_META, formatDate } from "@/lib/task-ui";
import RemedialModal from "../../RemedialModal";

const EVENT_META: Record<string, string> = {
  KNOWLEDGE_COMPLETED: "📚",
  PRACTICE_COMPLETED: "✏️",
  PRACTICE_CORRECTED: "✅",
  GUIDED_COMPLETED: "💡",
  SIMULATION_SUBMITTED: "🗺️",
  TASK_COMPLETED: "🏁",
  TASK_STARTED: "▶️",
  TEACHER_FEEDBACK_RECEIVED: "💬",
};

export default function StudentDetailPage() {
  const { state } = useApp();
  const router = useRouter();
  const params = useParams();
  const email = decodeURIComponent(String(params.email));

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/students?email=" + encodeURIComponent(email), {
        headers: { Authorization: "Bearer " + getAuthToken() },
      });
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
  }, [email]);

  useEffect(() => { if (state.role === "teacher") load(); }, [state.role, load]);

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

  const qs = data.quizStats || { total: 0, correct: 0, rate: null };
  const tasks: any[] = data.tasks || [];
  const wrongQuizzes: any[] = (data.quizzes || []).filter((q: any) => !q.is_correct);
  const taskDone = tasks.filter((t: any) => t.status === "COMPLETED").length;
  const taskRevision = tasks.filter((t: any) => t.status === "REVISION_REQUIRED").length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <button onClick={() => router.push("/teacher")} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] mb-4">
        ← 返回教学管理
      </button>

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">🧑‍🎓 {data.user?.name || email.split("@")[0]}</h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">{email}</p>
        </div>
        <button onClick={() => setModalOpen(true)}
          className="px-4 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90">
          🔁 布置补充学习
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[
          ["任务完成", `${taskDone}/${tasks.length}`, "📋", "bg-blue-50"],
          ["需修改任务", taskRevision, "🔔", "bg-red-50"],
          ["测验正确率", qs.rate !== null ? qs.rate + "%" : "—", qs.rate !== null && qs.rate >= 70 ? "✅" : "💪", "bg-green-50"],
          ["错题数", wrongQuizzes.length, "❌", "bg-amber-50"],
          ["薄弱知识点", (data.weakNodes || []).length, "🎯", "bg-purple-50"],
        ].map(([l, v, i, c]) => (
          <div key={String(l)} className={`${c} rounded-xl p-4`}>
            <div className="flex justify-between"><span className="text-xs opacity-70">{String(l)}</span><span className="text-sm">{String(i)}</span></div>
            <div className="text-xl font-bold mt-1">{String(v)}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 任务完成情况 */}
        <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">📋 任务完成情况</h3></div>
          <div className="max-h-96 overflow-y-auto divide-y">
            {tasks.length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">暂无任务</div>
            ) : tasks.map((t: any) => {
              const stMeta = TASK_STATUS_META[t.effective_status as keyof typeof TASK_STATUS_META] || TASK_STATUS_META.TODO;
              return (
                <div key={t.id} className="px-5 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{t.title}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${stMeta.cls}`}>{stMeta.label}</span>
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
                    {TASK_TYPE_META[t.type as keyof typeof TASK_TYPE_META]?.label} · 截止 {formatDate(t.deadline)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 薄弱知识点 */}
        <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">🎯 薄弱知识点</h3></div>
          <div className="max-h-96 overflow-y-auto divide-y">
            {(data.weakNodes || []).length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">暂无数据</div>
            ) : data.weakNodes.map((n: any) => {
              const m = Number(n.mastery ?? 0);
              return (
                <div key={n.node_id} className="px-5 py-3">
                  <div className="flex justify-between text-xs"><span className="font-medium">{n.node_name}</span><span className={m < 60 ? "text-red-500" : "text-green-600"}>掌握 {m}%</span></div>
                  <div className="h-1.5 bg-gray-100 rounded-full mt-2">
                    <div className={`h-1.5 rounded-full ${m >= 80 ? "bg-green-500" : m >= 60 ? "bg-yellow-500" : "bg-red-400"}`} style={{ width: `${Math.min(100, m)}%` }} />
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] mt-1">练习 {n.quiz_correct}/{n.quiz_total}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 仿真提交与反馈 */}
        <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">🗺️ 任务提交与教师反馈</h3></div>
          <div className="max-h-96 overflow-y-auto divide-y">
            {(data.submissions || []).length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">暂无提交</div>
            ) : data.submissions.slice(0, 10).map((s: any) => (
              <div key={s.id} className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{s.task_title}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">V{s.version}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ml-auto ${s.status === "passed" ? "bg-green-50 text-green-700" : s.status === "revision_required" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>
                    {s.status === "passed" ? "已通过" : s.status === "revision_required" ? "需修改" : "待批阅"}
                  </span>
                </div>
                {s.judgment && <p className="text-xs text-[var(--color-text-secondary)] mt-1.5 line-clamp-2">判断：{s.judgment}</p>}
                {s.feedback_content && (
                  <p className="text-xs bg-gray-50 rounded-lg p-2 mt-1.5">
                    <span className="text-[var(--color-text-muted)]">评语：</span>{s.feedback_content}
                  </p>
                )}
                <div className="text-[10px] text-[var(--color-text-muted)] mt-1">{formatDate(s.submitted_at)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 最近学习记录 */}
        <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">🕐 最近学习记录</h3></div>
          <div className="max-h-96 overflow-y-auto divide-y">
            {(data.events || []).length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">暂无记录</div>
            ) : data.events.slice(0, 15).map((e: any) => (
              <div key={e.id} className="px-5 py-2.5 flex items-center gap-3">
                <span>{EVENT_META[e.type] || "•"}</span>
                <span className="text-xs flex-1 truncate">{e.title}</span>
                <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{formatDate(e.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 错题 */}
      <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden mt-6">
        <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">❌ 最近错题（{wrongQuizzes.length} 题）</h3></div>
        <div className="max-h-80 overflow-y-auto divide-y">
          {wrongQuizzes.length === 0 ? (
            <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">暂无错题</div>
          ) : wrongQuizzes.slice(0, 15).map((q: any) => (
            <div key={q.id} className="px-5 py-3">
              <p className="text-xs font-medium">📝 {q.question}</p>
              <div className="text-[11px] mt-1 space-y-0.5">
                <div className="text-red-600">你的答案：{q.student_answer || "未作答"}</div>
                <div className="text-green-700">正确答案：{q.correct_answer}</div>
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)] mt-1">{q.topic || "未分类"} · {formatDate(q.created_at)}</div>
            </div>
          ))}
        </div>
      </div>

      {modalOpen && (
        <RemedialModal open={modalOpen} onClose={() => setModalOpen(false)} targetEmails={[email]}
          presetTitle={`补充学习：${data.user?.name || email.split("@")[0]}`}
          onCreated={() => load()} />
      )}
    </div>
  );
}
