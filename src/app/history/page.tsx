"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/contexts/AppContext";
import { getAuthToken } from "@/contexts/AppContext";
import { formatDate } from "@/lib/task-ui";
import type { LearningEvent, QaMessage } from "@/types";

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

const FEEDBACK_REASONS = ["内容错误", "解释不清", "答非所问", "信息不完整", "其他"];

export default function HistoryPage() {
  const { state } = useApp();
  const router = useRouter();
  const [tab, setTab] = useState<"events" | "mistakes" | "qa">("events");
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [quizResults, setQuizResults] = useState<any[]>([]);
  const [correctedIds, setCorrectedIds] = useState<Set<number>>(new Set());
  const [qaMessages, setQaMessages] = useState<QaMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // AI 反馈弹窗
  const [fbModal, setFbModal] = useState<{ messageId: number; reason: string; note: string; open: boolean }>({
    messageId: 0, reason: "内容错误", note: "", open: false,
  });
  const [fbSending, setFbSending] = useState(false);
  const [fbDoneIds, setFbDoneIds] = useState<Set<number>>(new Set());

  const headers = { Authorization: "Bearer " + getAuthToken() };
  const jsonHeaders = { "Content-Type": "application/json", Authorization: "Bearer " + getAuthToken() };

  const loadEvents = useCallback(async () => {
    const r = await fetch("/api/learning-events", { headers });
    if (r.ok) setEvents(await r.json());
  }, []);
  const loadMistakes = useCallback(async () => {
    const [qRes, cRes] = await Promise.all([
      fetch("/api/quiz-results", { headers }),
      fetch("/api/corrections", { headers }),
    ]);
    if (qRes.ok) setQuizResults(await qRes.json()); // 保留全量行：错题列表过滤依赖"被正确重做取代"判断
    if (cRes.ok) setCorrectedIds(new Set((await cRes.json()).ids || []));
  }, []);
  const loadQa = useCallback(async () => {
    const r = await fetch("/api/qa-messages", { headers });
    if (r.ok) setQaMessages(await r.json());
  }, []);

  useEffect(() => {
    if (state.role !== "student") return;
    setLoading(true);
    Promise.all([loadEvents(), loadMistakes(), loadQa()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.role]);

  useEffect(() => {
    if (state.authLoading) return;
    if (!state.role) router.replace("/login?redirect=" + encodeURIComponent("/history"));
    else if (state.role !== "student") router.replace("/teacher");
  }, [state.authLoading, state.role, router]);

  const markCorrected = async (q: any) => {
    try {
      const r = await fetch("/api/learning-events", {
        method: "POST", headers: jsonHeaders,
        body: JSON.stringify({
          type: "PRACTICE_CORRECTED", title: "订正错题",
          summary: (q.question || "").slice(0, 100),
          refType: "quiz_result", refId: String(q.id),
        }),
      });
      if (r.ok) {
        setCorrectedIds((prev) => new Set(prev).add(Number(q.id)));
        loadEvents();
      } else {
        const d = await r.json().catch(() => ({}));
        alert(d.error || "操作失败");
      }
    } catch { alert("网络错误"); }
  };

  // ── 错题重新作答（仅存储了选项的题目可用） ──
  const [retrySel, setRetrySel] = useState<Record<number, string>>({});
  const [retrying, setRetrying] = useState<Set<number>>(new Set());
  const [retryOpen, setRetryOpen] = useState<Set<number>>(new Set());

  const answerText = (q: any, ans: string | null | undefined): string => {
    if (!ans) return "未作答";
    if (/^[A-D]$/.test(ans) && Array.isArray(q.options) && q.options.length > 0) {
      const idx = ans.charCodeAt(0) - 65;
      if (q.options[idx]) return `${ans}. ${q.options[idx]}`;
    }
    return ans;
  };

  const correctLetter = (q: any): string | null => {
    if (/^[A-D]$/.test(q.correct_answer || "")) return q.correct_answer;
    const idx = Array.isArray(q.options) ? q.options.indexOf(q.correct_answer) : -1;
    return idx >= 0 ? String.fromCharCode(65 + idx) : null;
  };

  const retryQuiz = async (q: any) => {
    const letter = retrySel[q.id];
    const correct = correctLetter(q);
    if (!letter || !correct) return;
    setRetrying((prev) => new Set(prev).add(q.id));
    try {
      const r = await fetch("/api/quiz", {
        method: "POST", headers: jsonHeaders,
        body: JSON.stringify({
          question: q.question, student_answer: letter, correct_answer: correct,
          is_correct: letter === correct, topic: q.topic || "未分类",
          options: q.options || [], explanation: q.explanation || "",
        }),
      });
      if (!r.ok) { alert("重新作答保存失败"); return; }
      // 订正事件（正确与否都算订正一次；答对后该题因 is_correct=true 自动移出错题本）
      await fetch("/api/learning-events", {
        method: "POST", headers: jsonHeaders,
        body: JSON.stringify({
          type: "PRACTICE_CORRECTED", title: letter === correct ? "错题订正成功" : "错题再次作答",
          summary: (q.question || "").slice(0, 100),
          refType: "quiz_result", refId: String(q.id),
        }),
      });
      setRetryOpen((prev) => { const n = new Set(prev); n.delete(q.id); return n; });
      setRetrySel((prev) => ({ ...prev, [q.id]: "" }));
      await Promise.all([loadMistakes(), loadEvents()]);
    } catch { alert("网络错误"); }
    setRetrying((prev) => { const n = new Set(prev); n.delete(q.id); return n; });
  };

  const submitFeedback = async () => {
    setFbSending(true);
    try {
      const r = await fetch(`/api/qa-messages/${fbModal.messageId}/feedback`, {
        method: "POST", headers: jsonHeaders,
        body: JSON.stringify({ reason: fbModal.reason, note: fbModal.note }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || "反馈失败");
      else {
        setFbDoneIds((prev) => new Set(prev).add(fbModal.messageId));
        setFbModal({ messageId: 0, reason: "内容错误", note: "", open: false });
        loadQa();
      }
    } catch { alert("网络错误"); }
    setFbSending(false);
  };

  if (state.authLoading || !state.role || state.role !== "student") {
    return <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">加载中...</div>;
  }

  // 按日期分组学习历史
  const grouped: { date: string; items: LearningEvent[] }[] = [];
  for (const e of events) {
    const date = new Date(e.created_at).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
    const last = grouped[grouped.length - 1];
    if (last && last.date === date) last.items.push(e);
    else grouped.push({ date, items: [e] });
  }

  // 错题按知识点分组 + 同题错误次数；已被"重新作答正确"取代的旧错题不展示
  // （重做成功后新写入一条正确记录，旧错题行由更新的正确记录覆盖，保持历史可查且列表干净）
  const supersededByCorrect = (q: any) => {
    return quizResults.some(
      (r) => r.is_correct && r.question === q.question && new Date(r.created_at) > new Date(q.created_at),
    );
  };
  const wrongByTopic: { topic: string; items: any[] }[] = [];
  for (const q of quizResults) {
    if (q.is_correct || supersededByCorrect(q)) continue;
    const topic = q.topic || "未分类";
    let group = wrongByTopic.find((g) => g.topic === topic);
    if (!group) { group = { topic, items: [] }; wrongByTopic.push(group); }
    const existing = group.items.find((i) => i.question === q.question);
    if (existing) existing.times += 1;
    else group.items.push({ ...q, times: 1 });
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">学习档案</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">学习历史、错题订正与 AI 问答记录</p>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {[
          { k: "events" as const, l: "🕐 学习历史" },
          { k: "mistakes" as const, l: "❌ 我的错题" },
          { k: "qa" as const, l: "🤖 AI 问答历史" },
        ].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.k ? "bg-white text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"}`}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === "events" && (
        <div>
          {loading ? (
            <div className="p-10 text-center text-sm text-[var(--color-text-muted)]">加载中...</div>
          ) : grouped.length === 0 ? (
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
              <div className="text-4xl mb-3">🕐</div>
              <p className="text-sm text-[var(--color-text-secondary)]">暂无学习记录，开始学习后会自动记录</p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map((g) => (
                <div key={g.date}>
                  <div className="text-xs font-semibold text-[var(--color-text-muted)] mb-2 ml-1">{g.date}</div>
                  <div className="bg-white rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                    {g.items.map((e) => (
                      <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                        <span className="text-lg mt-0.5">{EVENT_META[e.type] || "•"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[var(--color-text)]">{e.title}</div>
                          {e.summary && <div className="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-1">{e.summary}</div>}
                        </div>
                        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 mt-1">
                          {new Date(e.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "mistakes" && (
        <div>
          {wrongByTopic.length === 0 ? (
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
              <div className="text-4xl mb-3">🎉</div>
              <p className="text-sm text-[var(--color-text-secondary)]">暂无错题，继续保持</p>
            </div>
          ) : (
            <div className="space-y-5">
              {wrongByTopic.map((g) => (
                <div key={g.topic} className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
                  <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
                    <h3 className="text-sm font-bold text-[var(--color-text)]">{g.topic}</h3>
                    <span className="text-xs text-[var(--color-text-muted)]">{g.items.length} 题 · 共 {g.items.reduce((s, i) => s + i.times, 0)} 次错误</span>
                  </div>
                  <div className="divide-y divide-[var(--color-border)]">
                    {g.items.map((q, i) => {
                      const corrected = correctedIds.has(Number(q.id));
                      const canRetry = Array.isArray(q.options) && q.options.length >= 2 && correctLetter(q) !== null;
                      const retryExpanded = retryOpen.has(q.id);
                      return (
                        <div key={i} className="px-5 py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[var(--color-text)]">📝 {q.question}</p>
                              <div className="text-xs mt-2 space-y-1">
                                <div className="text-red-600">你的答案：{answerText(q, q.student_answer)}</div>
                                <div className="text-green-700">正确答案：{answerText(q, q.correct_answer)}</div>
                                {q.explanation && <div className="text-[var(--color-text-muted)]">💡 {q.explanation}</div>}
                                <div className="text-[var(--color-text-muted)]">错 {q.times} 次 · 最近 {formatDate(q.created_at)}</div>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              {corrected ? (
                                <span className="text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-700 font-medium">✅ 已订正</span>
                              ) : (
                                <button onClick={() => markCorrected(q)}
                                  className="text-xs px-2.5 py-1 rounded-full border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-bg)]">
                                  标记已订正
                                </button>
                              )}
                              <div className="flex items-center gap-2">
                                {canRetry && !corrected && (
                                  <button onClick={() => setRetryOpen((prev) => { const n = new Set(prev); if (n.has(q.id)) n.delete(q.id); else n.add(q.id); return n; })}
                                    className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-primary)] text-white hover:opacity-90">
                                    {retryExpanded ? "收起" : "重新作答"}
                                  </button>
                                )}
                                <a href="/knowledge" className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">
                                  复习相关知识点 →
                                </a>
                              </div>
                            </div>
                          </div>
                          {retryExpanded && (
                            <div className="mt-3 rounded-lg border border-[var(--color-border)] p-3 bg-gray-50">
                              <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">重新作答（提交后即时判分）</p>
                              <div className="space-y-1.5">
                                {q.options.map((opt: string, oi: number) => {
                                  const letter = String.fromCharCode(65 + oi);
                                  return (
                                    <label key={oi} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer ${retrySel[q.id] === letter ? "border-[var(--color-primary)] bg-white" : "border-transparent hover:bg-white"}`}>
                                      <input type="radio" name={`retry-${q.id}`} checked={retrySel[q.id] === letter}
                                        onChange={() => setRetrySel((prev) => ({ ...prev, [q.id]: letter }))} className="accent-[var(--color-primary)]" />
                                      <span>{letter}. {opt}</span>
                                    </label>
                                  );
                                })}
                              </div>
                              <button onClick={() => retryQuiz(q)} disabled={retrying.has(q.id) || !retrySel[q.id]}
                                className="mt-2.5 px-4 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                                {retrying.has(q.id) ? "提交中..." : "提交答案"}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "qa" && (
        <div className="space-y-3">
          {qaMessages.length === 0 ? (
            <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
              <div className="text-4xl mb-3">🤖</div>
              <p className="text-sm text-[var(--color-text-secondary)]">暂无 AI 问答记录，去知识问答页提问后会自动存档</p>
            </div>
          ) : (
            qaMessages.map((m) => {
              const isExpanded = expanded.has(m.id);
              const hasFeedback = m.feedback_count > 0 || fbDoneIds.has(m.id);
              const hasTeacherEdit = (m.latest_version ?? 0) >= 2;
              return (
                <div key={m.id} className="bg-white rounded-xl border border-[var(--color-border)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--color-text)]">❓ {m.question}</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        {formatDate(m.created_at)}
                        {(m.references_data?.length ?? 0) > 0 && <span className="ml-3">📖 引用 {(m.references_data || []).length} 处</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">AI 生成</span>
                      {hasTeacherEdit && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700">教师已修正 V{m.latest_version}</span>}
                      {hasFeedback ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">已反馈 · 审核中</span>
                      ) : (
                        <button onClick={() => setFbModal({ messageId: m.id, reason: "内容错误", note: "", open: true })}
                          className="text-[10px] px-2 py-0.5 rounded-full border border-red-200 text-red-500 hover:bg-red-50">
                          这条回答有问题
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={`mt-2.5 text-sm text-[var(--color-text-secondary)] leading-6 ${isExpanded ? "" : "line-clamp-3"}`}>
                    {m.answer}
                  </div>
                  {m.answer.length > 150 && (
                    <button onClick={() => setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                      return next;
                    })} className="text-xs text-[var(--color-primary)] mt-1.5 hover:underline">
                      {isExpanded ? "收起" : "展开全文"}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* AI 反馈弹窗 */}
      {fbModal.open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setFbModal((p) => ({ ...p, open: false }))}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[var(--color-text)] mb-1">反馈 AI 回答问题</h3>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">你的反馈将提交给教师审核，帮助改进平台内容</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">问题类型</label>
                <div className="flex flex-wrap gap-2">
                  {FEEDBACK_REASONS.map((r) => (
                    <button key={r} onClick={() => setFbModal((p) => ({ ...p, reason: r }))}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${fbModal.reason === r ? "border-[var(--color-primary)] bg-[var(--color-primary-bg)] text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-gray-300"}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">补充说明（可选）</label>
                <textarea value={fbModal.note} onChange={(e) => setFbModal((p) => ({ ...p, note: e.target.value }))} rows={3}
                  placeholder="例如：公式参数写错了……"
                  className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-y" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setFbModal((p) => ({ ...p, open: false }))}
                className="px-4 py-2 text-sm border border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] hover:bg-gray-50">取消</button>
              <button onClick={submitFeedback} disabled={fbSending}
                className="px-4 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                {fbSending ? "提交中..." : "提交反馈"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
