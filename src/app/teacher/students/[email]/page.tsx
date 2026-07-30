"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useApp } from "@/contexts/AppContext";

export default function StudentDetailPage() {
  const { state } = useApp();
  const params = useParams();
  const email = decodeURIComponent(String(params.email));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (state.role !== "teacher") return;
      try {
        const r = await fetch("/api/students?email=" + encodeURIComponent(email));
        if (r.ok) setData(await r.json());
      } catch (e) {}
      setLoading(false);
    })();
  }, [email, state.role]);

  if (!state.role || state.role !== "teacher") return <div className="p-8 text-center text-red-500">仅教师可访问</div>;
  if (loading) return <div className="p-8 text-center">加载中...</div>;
  if (!data) return <div className="p-8 text-center">学生数据未找到</div>;

  const s = data.stats;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{email}</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">学生学习详情</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[["提问次数", s.totalQuestions, "💬", "bg-blue-50"], ["测验次数", s.totalQuizzes, "📝", "bg-green-50"], ["正确率", s.rate + "%", s.rate >= 70 ? "✅" : "💪", "bg-amber-50"], ["正确数", s.correct, "🎯", "bg-purple-50"], ["知识点", s.topics?.length || 0, "🏷️", "bg-rose-50"]].map(([l, v, i, c]) => (
          <div key={String(l)} className={c + " rounded-xl p-4"}><div className="flex justify-between"><span className="text-xs text-[var(--color-text-secondary)]">{l}</span><span className="text-sm">{i}</span></div><div className="text-xl font-bold mt-1">{v}</div></div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-[var(--color-border)]">
          <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">📝 问答记录</h3></div>
          <div className="max-h-96 overflow-y-auto divide-y">
            {data.records?.length === 0 ? <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">暂无记录</div> :
              data.records?.slice(0, 20).map((r: any) => (
                <div key={r.id} className="px-5 py-3">
                  <div className="text-sm font-medium truncate">{r.question}</div>
                  <div className="text-[10px] text-[var(--color-text-muted)] mt-1">{new Date(r.created_at).toLocaleString("zh-CN")}</div>
                </div>
              ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[var(--color-border)]">
          <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">📊 测验结果</h3></div>
          <div className="max-h-96 overflow-y-auto divide-y">
            {data.quizzes?.length === 0 ? <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">暂无测验</div> :
              data.quizzes?.slice(0, 20).map((q: any) => (
                <div key={q.id} className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span>{q.is_correct ? "✅" : "❌"}</span>
                    <span className="text-sm font-medium truncate">{q.question}</span>
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)] mt-1">你的答案: {q.student_answer || "—"} · 正确: {q.correct_answer} · {q.topic || ""}</div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
