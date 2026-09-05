"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/contexts/AppContext";
import { getAuthToken } from "@/contexts/AppContext";
import { TASK_TYPE_META, TASK_STATUS_META, formatDate, formatDeadline } from "@/lib/task-ui";
import RemedialModal from "../../RemedialModal";

export default function TeacherTaskDetailPage() {
  const { state } = useApp();
  const router = useRouter();
  const params = useParams();
  const id = Number(params.id);

  const [task, setTask] = useState<any>(null);
  const [targets, setTargets] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [feedbackTexts, setFeedbackTexts] = useState<Record<string, string>>({});
  const [feedbackBusy, setFeedbackBusy] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);

  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + getAuthToken() };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/tasks/${id}`, { headers: { Authorization: "Bearer " + getAuthToken() } });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "加载失败");
        return;
      }
      const d = await r.json();
      setTask(d.task);
      setTargets(d.targets || []);
      setSubmissions(d.submissions || []);
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { if (state.role === "teacher") load(); }, [state.role, load]);

  const effectiveStatus = (st: any): string => {
    if (["TODO", "IN_PROGRESS"].includes(st.status) && task?.deadline && new Date(task.deadline) < new Date()) return "OVERDUE";
    return st.status;
  };

  const exportCsv = () => {
    const rows = [["学生", "状态", "最新提交版本", "提交时间", "自评/评语"]];
    for (const t of targets) {
      const es = effectiveStatus(t);
      const latest = latestByEmail[t.user_email];
      const note = latest ? (latest.feedback_content || "") : (t.completion_note || "");
      rows.push([
        t.name || t.user_email.split("@")[0],
        TASK_STATUS_META[es as keyof typeof TASK_STATUS_META]?.label || es,
        latest ? `V${latest.version}` : "",
        latest ? new Date(latest.submitted_at).toLocaleString("zh-CN", { hour12: false }) : "",
        note,
      ]);
    }
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `任务提交状态_${task?.title || "export"}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const submitFeedback = async (email: string, submissionId: number, status: "passed" | "revision_required") => {
    const content = (feedbackTexts[email] || "").trim();
    if (!content) { alert("请先填写评语"); return; }
    setFeedbackBusy((prev) => new Set(prev).add(email));
    try {
      const r = await fetch(`/api/submissions/${submissionId}/feedback`, {
        method: "POST", headers,
        body: JSON.stringify({ content, status }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || "操作失败");
      else {
        setFeedbackTexts((prev) => ({ ...prev, [email]: "" }));
        await load();
      }
    } catch { alert("网络错误"); }
    setFeedbackBusy((prev) => { const n = new Set(prev); n.delete(email); return n; });
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
  if (!task) return null;

  const meta = TASK_TYPE_META[task.type as keyof typeof TASK_TYPE_META];
  const counts: Record<string, number> = { TODO: 0, IN_PROGRESS: 0, SUBMITTED: 0, REVISION_REQUIRED: 0, COMPLETED: 0, OVERDUE: 0 };
  for (const t of targets) counts[effectiveStatus(t)] = (counts[effectiveStatus(t)] || 0) + 1;

  // 每个学生的最新提交（submissions 按时间倒序）
  const latestByEmail: Record<string, any> = {};
  for (const s of submissions) {
    if (!latestByEmail[s.user_email]) latestByEmail[s.user_email] = s;
  }

  const incompleteEmails = targets.filter((t) => !["COMPLETED"].includes(effectiveStatus(t))).map((t) => t.user_email);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <button onClick={() => router.push("/teacher")} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] mb-4">
        ← 返回教学管理
      </button>

      <div className="bg-white rounded-xl border border-[var(--color-border)] p-5 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.icon} {meta.label}</span>
          {task.class_name && <span className="text-[10px] text-[var(--color-text-muted)]">{task.class_name}</span>}
          <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">⏰ 截止 {formatDeadline(task.deadline)}</span>
        </div>
        <h1 className="text-xl font-bold text-[var(--color-text)] mt-2.5">{task.title}</h1>
        {task.description && <p className="text-sm text-[var(--color-text-secondary)] leading-6 mt-2 whitespace-pre-wrap">{task.description}</p>}
        {task.observe_items?.length > 0 && (
          <div className="mt-3 text-xs text-[var(--color-text-secondary)]">
            <b>观察指标：</b>{task.observe_items.join("、")}
          </div>
        )}
        {task.prompt_questions?.length > 0 && (
          <div className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
            <b>需要回答：</b>{task.prompt_questions.join("；")}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mb-4">
        {[
          ["未开始", counts.TODO, "bg-gray-50 text-gray-600"],
          ["进行中", counts.IN_PROGRESS, "bg-blue-50 text-blue-700"],
          ["已提交", counts.SUBMITTED, "bg-amber-50 text-amber-700"],
          ["已完成", counts.COMPLETED, "bg-green-50 text-green-700"],
          ["已逾期", counts.OVERDUE, "bg-orange-50 text-orange-700"],
        ].map(([l, v, c]) => (
          <div key={String(l)} className={`${c} rounded-xl p-3 text-center`}>
            <div className="text-xl font-bold">{String(v)}</div>
            <div className="text-[10px] opacity-70">{String(l)}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-[var(--color-text)]">学生提交与批阅</span>
        <button onClick={exportCsv}
          className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-border)] hover:bg-gray-50">
          ⬇️ 导出提交状态 CSV
        </button>
        {incompleteEmails.length > 0 && (
          <button onClick={() => { setChecked(new Set(incompleteEmails)); setModalOpen(true); }}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-bg)]">
            对未完成学生布置补充学习（{incompleteEmails.length} 人）
          </button>
        )}
      </div>

      <div className="space-y-3">
        {targets.length === 0 ? (
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-10 text-center text-sm text-[var(--color-text-muted)]">该任务暂无学生</div>
        ) : (
          targets.map((t) => {
            const es = effectiveStatus(t);
            const stMeta = TASK_STATUS_META[es as keyof typeof TASK_STATUS_META] || TASK_STATUS_META.TODO;
            const latest = latestByEmail[t.user_email];
            const isExpanded = expanded.has(t.user_email);
            const canFeedback = latest && ["pending", "revision_required"].includes(latest.status);
            return (
              <div key={t.user_email} className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
                <button onClick={() => setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(t.user_email)) next.delete(t.user_email); else next.add(t.user_email);
                  return next;
                })} className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 text-left">
                  <span className="text-sm font-medium text-[var(--color-text)]">{t.name || t.user_email.split("@")[0]}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stMeta.cls}`}>{stMeta.label}</span>
                  {latest && <span className="text-[10px] text-[var(--color-text-muted)]">最新提交 V{latest.version} · {formatDate(latest.submitted_at)}</span>}
                  <span className="text-xs text-[var(--color-text-muted)] ml-auto">{isExpanded ? "▲" : "▼"}</span>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-4 pt-1 border-t border-[var(--color-border)] bg-gray-50">
                    {latest ? (
                      <div className="mt-3 space-y-3">
                        {latest.judgment && (
                          <div className="bg-white rounded-lg p-3">
                            <div className="text-xs font-semibold text-blue-800 mb-1">我的判断</div>
                            <p className="text-xs text-[var(--color-text-secondary)] leading-5 whitespace-pre-wrap">{latest.judgment}</p>
                          </div>
                        )}
                        {latest.explanation && (
                          <div className="bg-white rounded-lg p-3">
                            <div className="text-xs font-semibold text-teal-800 mb-1">我的解释</div>
                            <p className="text-xs text-[var(--color-text-secondary)] leading-5 whitespace-pre-wrap">{latest.explanation}</p>
                          </div>
                        )}
                        {latest.reflection && (
                          <div className="bg-white rounded-lg p-3">
                            <div className="text-xs font-semibold text-purple-800 mb-1">我的反思</div>
                            <p className="text-xs text-[var(--color-text-secondary)] leading-5 whitespace-pre-wrap">{latest.reflection}</p>
                          </div>
                        )}
                        {latest.answers?.length > 0 && (
                          <div className="bg-white rounded-lg p-3">
                            <div className="text-xs font-semibold text-[var(--color-text)] mb-2">作答情况（{latest.answers.filter((a: any) => a.isCorrect).length}/{latest.answers.length} 正确）</div>
                            <div className="space-y-2">
                              {latest.answers.map((a: any, i: number) => (
                                <div key={i} className={`text-xs rounded-lg p-2.5 ${a.isCorrect ? "bg-green-50" : "bg-red-50"}`}>
                                  <div className="font-medium mb-1">{a.isCorrect ? "✅" : "❌"} {a.question}</div>
                                  {!a.isCorrect && <div className="text-red-600">学生答案：{a.studentAnswer || "未作答"}</div>}
                                  <div className="text-green-700">正确答案：{a.correctAnswer}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {latest.feedback_content ? (
                          <div className={`rounded-lg p-3 ${latest.feedback_status === "passed" ? "bg-green-50" : "bg-red-50"}`}>
                            <div className="text-xs font-semibold mb-1">{latest.feedback_status === "passed" ? "✅ 已批阅通过" : "🔔 已要求修改"}</div>
                            <p className="text-xs leading-5">{latest.feedback_content}</p>
                          </div>
                        ) : null}

                        {canFeedback && (
                          <div className="bg-white rounded-lg p-3">
                            <div className="text-xs font-semibold mb-2">批阅（{latest.feedback_status === "revision_required" ? "重新批阅" : "待批阅"}）</div>
                            <textarea value={feedbackTexts[t.user_email] || ""}
                              onChange={(e) => setFeedbackTexts((prev) => ({ ...prev, [t.user_email]: e.target.value }))}
                              rows={3} placeholder="写评语：指出优点和不足，给出具体修改建议"
                              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-y" />
                            <div className="flex justify-end gap-2 mt-2">
                              <button onClick={() => submitFeedback(t.user_email, latest.id, "revision_required")}
                                disabled={feedbackBusy.has(t.user_email)}
                                className="px-3 py-1.5 text-xs rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50">
                                要求修改
                              </button>
                              <button onClick={() => submitFeedback(t.user_email, latest.id, "passed")}
                                disabled={feedbackBusy.has(t.user_email)}
                                className="px-4 py-1.5 text-xs rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50">
                                ✓ 通过
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : t.completion_note ? (
                      <div className="mt-3 bg-white rounded-lg p-3">
                        <div className="text-xs font-semibold text-[var(--color-text)] mb-1">🎓 学生自评（标记完成时填写）</div>
                        <p className="text-xs text-[var(--color-text-secondary)] leading-5">{t.completion_note}</p>
                        <div className="text-[10px] text-[var(--color-text-muted)] mt-1">状态：学生自评完成（未提交文件）</div>
                      </div>
                    ) : (
                      <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">该学生尚未提交</div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {modalOpen && checked.size > 0 && (
        <RemedialModal open={modalOpen} onClose={() => setModalOpen(false)} targetEmails={[...checked]}
          presetTitle={`补充学习：${task.title}`}
          onCreated={() => { setChecked(new Set()); load(); }} />
      )}
    </div>
  );
}
