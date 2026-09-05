"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/contexts/AppContext";
import { getAuthToken } from "@/contexts/AppContext";
import { TASK_TYPE_META, TASK_STATUS_META, formatDate, formatDeadline } from "@/lib/task-ui";
import type { Task, TaskSubmission } from "@/types";

interface StudentTaskView {
  status: string;
  effective_status: string;
  started_at: string | null;
  completed_at: string | null;
}

export default function TaskDetailPage() {
  const { state } = useApp();
  const router = useRouter();
  const params = useParams();
  const id = Number(params.id);

  const [task, setTask] = useState<Task | null>(null);
  const [st, setSt] = useState<StudentTaskView | null>(null);
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [nodeNames, setNodeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // 练习作答
  const [practiceAnswers, setPracticeAnswers] = useState<Record<number, string>>({});
  // 仿真提交
  const [judgment, setJudgment] = useState("");
  const [explanation, setExplanation] = useState("");
  const [reflection, setReflection] = useState("");

  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + getAuthToken() };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${id}`, { headers: { Authorization: "Bearer " + getAuthToken() } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "任务加载失败");
        return;
      }
      const data = await res.json();
      setTask(data.task);
      setSt(data.studentTask);
      setSubmissions(data.submissions || []);
      setAttachments(data.attachments || []);
      // 预填上次提交内容（要求修改时直接在其上修改）
      const latest: TaskSubmission | undefined = (data.submissions || [])[0];
      if (latest) {
        setJudgment(latest.judgment || "");
        setExplanation(latest.explanation || "");
        setReflection(latest.reflection || "");
      }
    } catch (e) {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (state.role === "student") load();
  }, [state.role, load]);

  // 知识点名称映射
  useEffect(() => {
    if (!task || task.knowledge_node_ids.length === 0) return;
    fetch("/api/knowledge-graph", { headers: { Authorization: "Bearer " + getAuthToken() } })
      .then((r) => r.ok ? r.json() : null)
      .then((g) => {
        if (!g?.nodes) return;
        const map: Record<string, string> = {};
        for (const n of g.nodes) map[n.id] = n.name;
        setNodeNames(map);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  useEffect(() => {
    if (state.authLoading) return;
    if (!state.role) router.replace("/login?redirect=" + encodeURIComponent(`/tasks/${id}`));
    else if (state.role !== "student") router.replace("/teacher");
  }, [state.authLoading, state.role, router, id]);

  const patch = useCallback(async (action: string, note?: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers, body: JSON.stringify({ action, note }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) alert(data.error || "操作失败");
      else await load();
    } catch {
      alert("网络错误");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, load]);

  // 附件（仿真任务提交证据；≤10MB/个，≤5 个）
  const [attFiles, setAttFiles] = useState<{ fileKey: string; fileName: string; fileSize: number; mime: string }[]>([]);
  const [attUploading, setAttUploading] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);

  const pickAttachments = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const remaining = 5 - attFiles.length;
    const picked = Array.from(fileList).slice(0, Math.max(0, remaining));
    if (picked.length === 0) { alert("每次提交最多 5 个附件"); return; }
    setAttUploading(true);
    try {
      for (const file of picked) {
        if (file.size > 10 * 1024 * 1024) { alert(`「${file.name}」超过 10MB，已跳过`); continue; }
        const presign = await fetch("/api/attachments", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + getAuthToken() },
          body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size }),
        });
        if (!presign.ok) { alert("附件上传通道不可用"); continue; }
        const { uploadUrl, fileKey, contentType } = await presign.json();
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("上传失败")));
          xhr.onerror = () => reject(new Error("网络错误"));
          xhr.send(file);
        });
        setAttFiles((prev) => [...prev, { fileKey, fileName: file.name, fileSize: file.size, mime: file.type }]);
      }
    } catch (e: any) { alert(e.message || "附件上传失败"); }
    setAttUploading(false);
  };

  const downloadAttachment = async (fileKey: string) => {
    try {
      const r = await fetch(`/api/attachments?key=${encodeURIComponent(fileKey)}`, { headers: { Authorization: "Bearer " + getAuthToken() } });
      if (!r.ok) { alert("下载失败"); return; }
      window.open((await r.json()).url, "_blank");
    } catch { alert("下载失败"); }
  };

  // 标记完成弹窗（必填"我的收获"，教师可见）
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");

  const submitCompleteNote = async () => {
    if (!noteText.trim()) { alert("请填写一句本次学习的收获"); return; }
    await patch("complete", noteText.trim());
    setNoteOpen(false);
    setNoteText("");
  };

  const submitPractice = useCallback(async () => {
    const answers = (task?.questions || []).map((q, index) => ({ index, studentAnswer: practiceAnswers[index] || "" }));
    if (answers.some((a) => !a.studentAnswer)) { alert("请完成所有题目后再提交"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${id}/submissions`, { method: "POST", headers, body: JSON.stringify({ answers }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) alert(data.error || "提交失败");
      else { setPracticeAnswers({}); await load(); }
    } catch {
      alert("网络错误");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, practiceAnswers, id, load]);

  const submitSim = useCallback(async () => {
    if (!judgment.trim() && !explanation.trim()) { alert("请至少填写「我的判断」或「我的解释」"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${id}/submissions`, {
        method: "POST", headers,
        body: JSON.stringify({ judgment: judgment.trim(), explanation: explanation.trim(), reflection: reflection.trim(), attachments: attFiles }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) alert(data.error || "提交失败");
      else { setAttFiles([]); await load(); }
    } catch {
      alert("网络错误");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [judgment, explanation, reflection, attFiles, id, load]);

  if (state.authLoading || loading) {
    return <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">加载中...</div>;
  }
  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="text-4xl mb-3">😕</div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">{error}</p>
        <button onClick={() => router.push("/tasks")} className="text-sm text-[var(--color-primary)] hover:underline">返回任务列表</button>
      </div>
    );
  }
  if (!task || !st) return null;

  const statusMeta = TASK_STATUS_META[st.effective_status as keyof typeof TASK_STATUS_META] || TASK_STATUS_META.TODO;
  const typeMeta = TASK_TYPE_META[task.type];
  const latest: TaskSubmission | undefined = submissions[0];
  const latestFeedback = latest?.feedback_content
    ? { content: latest.feedback_content, status: latest.feedback_status, at: latest.feedback_at }
    : null;

  const canSubmitSim = ["TODO", "IN_PROGRESS", "REVISION_REQUIRED"].includes(st.status);
  const canEditPractice = st.status !== "COMPLETED";
  const canMarkComplete = ["TODO", "IN_PROGRESS"].includes(st.status) && (task.type === "KNOWLEDGE" || task.type === "GUIDED" || task.type === "REMEDIAL");

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <button onClick={() => router.push("/tasks")} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] mb-4">
        ← 返回任务列表
      </button>

      {/* 头部 */}
      <div className="bg-white rounded-xl border border-[var(--color-border)] p-5 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeMeta.cls}`}>{typeMeta.icon} {typeMeta.label}</span>
          {task.type === "REMEDIAL" && <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 font-medium">教师补充学习</span>}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusMeta.cls}`}>{statusMeta.label}</span>
          {task.class_name && <span className="text-[10px] text-[var(--color-text-muted)]">{task.class_name}</span>}
        </div>
        <h1 className="text-xl font-bold text-[var(--color-text)] mt-3">{task.title}</h1>
        <div className="text-xs text-[var(--color-text-muted)] mt-2">
          ⏰ 截止 {formatDeadline(task.deadline)}
          {st.started_at && <span className="ml-4">▶️ 开始于 {formatDate(st.started_at)}</span>}
          {st.completed_at && <span className="ml-4">✅ 完成于 {formatDate(st.completed_at)}</span>}
        </div>
      </div>

      {/* 教师反馈（需修改时突出显示） */}
      {latestFeedback && (
        <div className={`rounded-xl border p-4 mb-4 ${latestFeedback.status === "revision_required" ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}`}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{latestFeedback.status === "revision_required" ? "🔔 教师反馈：需要修改" : "✅ 教师反馈：已通过"}</span>
            <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">{formatDate(latestFeedback.at)}</span>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] leading-6 mt-2">{latestFeedback.content}</p>
          {latestFeedback.status === "revision_required" && canSubmitSim && (
            <button onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}
              className="mt-2 text-xs text-red-700 font-medium hover:underline">
              在下方修改并重新提交 ↓
            </button>
          )}
        </div>
      )}

      {/* 任务说明 */}
      {task.description && (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-5 mb-4">
          <h3 className="text-sm font-bold text-[var(--color-text)] mb-2">
            {task.type === "SIMULATION" ? "🎯 任务目标" : "📄 任务说明"}
          </h3>
          <p className="text-sm text-[var(--color-text-secondary)] leading-7 whitespace-pre-wrap">{task.description}</p>
        </div>
      )}

      {/* 关联知识点 */}
      {task.knowledge_node_ids.length > 0 && (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-5 mb-4">
          <h3 className="text-sm font-bold text-[var(--color-text)] mb-2">🏷️ 关联知识点</h3>
          <div className="flex flex-wrap gap-2">
            {task.knowledge_node_ids.map((nid) => (
              <span key={nid} className="text-xs px-3 py-1.5 rounded-full bg-blue-50 text-blue-700">
                {nodeNames[nid] || nid}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 知识学习任务 */}
      {task.type === "KNOWLEDGE" && (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 mb-4 text-center">
          <div className="text-3xl mb-2">📚</div>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">在知识问答中围绕本任务的知识点提问学习，学完后回来标记完成</p>
          <div className="flex items-center justify-center gap-3">
            <a href="/knowledge" className="px-5 py-2.5 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90">
              前往知识问答学习
            </a>
            {canMarkComplete && (
              <button onClick={() => { setNoteText(""); setNoteOpen(true); }} disabled={busy}
                className="px-5 py-2.5 border border-[var(--color-primary)] text-[var(--color-primary)] rounded-lg text-sm font-medium hover:bg-[var(--color-primary-bg)] disabled:opacity-50">
                ✓ 标记完成
              </button>
            )}
          </div>
        </div>
      )}

      {/* 引导学习任务 */}
      {task.type === "GUIDED" && (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 mb-4 text-center">
          <div className="text-3xl mb-2">💡</div>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">进入引导学习，跟随 AI 苏格拉底式追问完成探究，结束后回来标记完成</p>
          <div className="flex items-center justify-center gap-3">
            <a href="/guided" className="px-5 py-2.5 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90">
              前往引导学习
            </a>
            {canMarkComplete && (
              <button onClick={() => { setNoteText(""); setNoteOpen(true); }} disabled={busy}
                className="px-5 py-2.5 border border-[var(--color-primary)] text-[var(--color-primary)] rounded-lg text-sm font-medium hover:bg-[var(--color-primary-bg)] disabled:opacity-50">
                ✓ 标记完成
              </button>
            )}
          </div>
        </div>
      )}

      {/* 练习任务 */}
      {(task.type === "PRACTICE" || task.type === "REMEDIAL") && task.questions && task.questions.length > 0 && (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-5 mb-4">
          <h3 className="text-sm font-bold text-[var(--color-text)] mb-3">✏️ 专项练习（{task.questions.length} 题）</h3>

          {canEditPractice ? (
            <div className="space-y-5">
              {task.questions.map((q, i) => (
                <div key={i} className="rounded-lg border border-[var(--color-border)] p-4">
                  <p className="text-sm font-medium text-[var(--color-text)] mb-3">{i + 1}. {q.q}</p>
                  <div className="space-y-2">
                    {q.options.map((opt) => (
                      <label key={opt} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-colors ${practiceAnswers[i] === opt ? "border-[var(--color-primary)] bg-[var(--color-primary-bg)]" : "border-gray-200 hover:border-gray-300"}`}>
                        <input type="radio" name={`q-${i}`} checked={practiceAnswers[i] === opt}
                          onChange={() => setPracticeAnswers((prev) => ({ ...prev, [i]: opt }))} className="accent-[var(--color-primary)]" />
                        <span className="text-[var(--color-text-secondary)]">{opt}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-3">
                <button onClick={submitPractice} disabled={busy}
                  className="px-5 py-2.5 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
                  {busy ? "提交中..." : st.status === "REVISION_REQUIRED" ? "重新提交" : st.status === "SUBMITTED" ? "重新作答" : "提交答案"}
                </button>
                {st.status === "SUBMITTED" && <span className="text-xs text-[var(--color-text-muted)]">已提交等待批阅，可重新作答刷新答案</span>}
              </div>
            </div>
          ) : (
            <div className="text-center py-3 text-sm text-green-700">✅ 本题组已完成</div>
          )}

          {/* 最近一次作答结果 */}
          {latest?.answers && latest.answers.length > 0 && (
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <h4 className="text-xs font-semibold text-[var(--color-text-muted)] mb-3">
                📋 最近作答（第 {latest.version} 版 · {formatDate(latest.submitted_at)}）
              </h4>
              <div className="space-y-3">
                {latest.answers.map((a: any, i: number) => (
                  <div key={i} className={`rounded-lg p-3 ${a.isCorrect ? "bg-green-50" : "bg-red-50"}`}>
                    <p className="text-xs font-medium text-[var(--color-text)] mb-1.5">
                      {a.isCorrect ? "✅" : "❌"} {i + 1}. {a.question}
                    </p>
                    <div className="text-[11px] leading-5">
                      {!a.isCorrect && (
                        <div className="text-red-600">你的答案：{a.studentAnswer || "未作答"}</div>
                      )}
                      <div className={a.isCorrect ? "text-green-700" : "text-green-700"}>正确答案：{a.correctAnswer}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 补充学习任务（教师指定重学/重做某个环节） */}
      {task.type === "REMEDIAL" && !(task.questions && task.questions.length > 0) && (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 mb-4">
          <div className="text-3xl mb-2 text-center">🔁</div>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4 text-center">按任务说明完成补充学习后，回来标记完成</p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <a href="/knowledge" className="px-4 py-2 border border-[var(--color-border)] rounded-lg text-sm hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors">📚 知识问答</a>
            <a href="/guided" className="px-4 py-2 border border-[var(--color-border)] rounded-lg text-sm hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors">💡 引导学习</a>
            <a href="/sandbox" className="px-4 py-2 border border-[var(--color-border)] rounded-lg text-sm hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors">🗺️ 电子沙盘</a>
            {canMarkComplete && (
              <button onClick={() => { setNoteText(""); setNoteOpen(true); }} disabled={busy}
                className="px-5 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
                ✓ 标记完成
              </button>
            )}
          </div>
        </div>
      )}

      {/* 仿真任务 */}
      {task.type === "SIMULATION" && (
        <>
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-5 mb-4">
            <div className="grid md:grid-cols-2 gap-4">
              {task.observe_items.length > 0 && (
                <div className="rounded-lg bg-amber-50 p-4">
                  <h4 className="text-sm font-semibold text-amber-800 mb-2">👀 请观察</h4>
                  <ul className="space-y-1.5">
                    {task.observe_items.map((item, i) => (
                      <li key={i} className="text-xs text-amber-900 flex gap-2"><span>•</span><span>{item}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              {task.prompt_questions.length > 0 && (
                <div className="rounded-lg bg-blue-50 p-4">
                  <h4 className="text-sm font-semibold text-blue-800 mb-2">❓ 需要回答</h4>
                  <ol className="space-y-1.5 list-decimal list-inside">
                    {task.prompt_questions.map((item, i) => (
                      <li key={i} className="text-xs text-blue-900">{item}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
            <div className="text-center mt-4">
              <a href="/sandbox" className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--color-primary)] text-white rounded-xl text-sm font-semibold hover:opacity-90">
                🗺️ 进入电子沙盘做仿真
              </a>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-2">在电子沙盘中完成仿真实验后，回到本页填写你的判断、解释与反思并提交</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-[var(--color-border)] p-5 mb-4">
            <h3 className="text-sm font-bold text-[var(--color-text)] mb-3">
              {st.status === "REVISION_REQUIRED" ? "✏️ 修改并重新提交" : "📝 我的提交"}
            </h3>

            {canSubmitSim ? (
              <div className="space-y-4">
                {[
                  { key: "judgment", label: "我的判断", placeholder: "例如：不透水率提高后，峰值流量明显增大，最大水深出现在 J35 节点……", value: judgment, set: setJudgment },
                  { key: "explanation", label: "我的解释", placeholder: "尝试解释为什么出现这种结果：产流面积增大、汇流时间缩短……", value: explanation, set: setExplanation },
                  { key: "reflection", label: "我的反思", placeholder: "如果调整方案（如增加 LID 设施、改变重现期），预期会发生什么变化？", value: reflection, set: setReflection },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">{f.label}</label>
                    <textarea value={f.value} onChange={(e) => f.set(e.target.value)} rows={4}
                      placeholder={f.placeholder}
                      className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-y" />
                  </div>
                ))}
                <div>
                  <label className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1.5 block">📎 附件（可选，≤10MB/个 · ≤5 个，如沙盘截图/分析图）</label>
                  <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                    onChange={(e) => { pickAttachments(e.target.files); e.target.value = ""; }}
                    className="block w-full text-xs text-[var(--color-text-muted)]" />
                  {attUploading && <p className="text-xs text-amber-600 mt-1">上传中…</p>}
                  {attFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {attFiles.map((f) => (
                        <span key={f.fileKey} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                          📎 {f.fileName}
                          <button onClick={() => setAttFiles((prev) => prev.filter((x) => x.fileKey !== f.fileKey))} className="hover:text-red-500">✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={submitSim} disabled={busy}
                  className="px-6 py-2.5 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
                  {busy ? "提交中..." : st.status === "REVISION_REQUIRED" ? "修改并重新提交" : "提交"}
                </button>
              </div>
            ) : (
              <div className="text-sm text-[var(--color-text-secondary)] text-center py-3">
                {st.status === "SUBMITTED" ? "⏳ 已提交，等待教师批阅" : "✅ 本任务已完成，教师已批阅通过"}
              </div>
            )}

            {/* 提交历史 */}
            {latest && (
              <div className="mt-5 border-t border-[var(--color-border)] pt-4">
                <h4 className="text-xs font-semibold text-[var(--color-text-muted)] mb-3">
                  📋 最近提交（第 {latest.version} 版 · {formatDate(latest.submitted_at)}）
                </h4>
                <div className="space-y-3 text-sm">
                  {latest.judgment && (
                    <div className="rounded-lg bg-blue-50 p-3">
                      <div className="text-xs font-semibold text-blue-800 mb-1">我的判断</div>
                      <p className="text-xs text-blue-900 leading-5 whitespace-pre-wrap">{latest.judgment}</p>
                    </div>
                  )}
                  {latest.explanation && (
                    <div className="rounded-lg bg-teal-50 p-3">
                      <div className="text-xs font-semibold text-teal-800 mb-1">我的解释</div>
                      <p className="text-xs text-teal-900 leading-5 whitespace-pre-wrap">{latest.explanation}</p>
                    </div>
                  )}
                  {latest.reflection && (
                    <div className="rounded-lg bg-purple-50 p-3">
                      <div className="text-xs font-semibold text-purple-800 mb-1">我的反思</div>
                      <p className="text-xs text-purple-900 leading-5 whitespace-pre-wrap">{latest.reflection}</p>
                    </div>
                  )}
                  {attachments.filter((a) => a.submission_id === latest.id).length > 0 && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-xs font-semibold text-[var(--color-text)] mb-1">📎 附件</div>
                      <div className="flex flex-wrap gap-2">
                        {attachments.filter((a) => a.submission_id === latest.id).map((a) => (
                          <button key={a.id} onClick={() => downloadAttachment(a.file_key)}
                            className="text-[10px] px-2 py-1 rounded-full bg-white border border-[var(--color-border)] hover:border-[var(--color-primary)]">
                            📎 {a.file_name}（{(a.file_size / 1024).toFixed(0)}KB）
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* 标记完成弹窗（必填"我的收获"） */}
      {noteOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setNoteOpen(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[var(--color-text)] mb-1">✓ 标记任务完成</h3>
            <p className="text-xs text-[var(--color-text-muted)] mb-3">写下你本次学习的收获（一句话即可，教师可见）</p>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} autoFocus
              placeholder="例如：理解了分流制与合流制的适用条件，也知道了溢流污染的控制思路"
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-y" />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setNoteOpen(false)} className="px-4 py-2 text-sm border border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] hover:bg-gray-50">取消</button>
              <button onClick={submitCompleteNote} disabled={busy || !noteText.trim()}
                className="px-5 py-2 text-sm bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                {busy ? "提交中..." : "确认完成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
