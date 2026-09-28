"use client";

import React, { useState, useEffect } from "react";
import { useApp, getAuthToken } from "@/contexts/AppContext";

export default function QuizBankPage() {
  const { state } = useApp();
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (state.role !== "teacher") return;
      try {
        const r = await fetch("/api/quiz-results", { headers: { Authorization: `Bearer ${getAuthToken()}` } });
        if (r.ok) setResults(await r.json());
      } catch (e) {}
      setLoading(false);
    })();
  }, [state.role]);

  if (!state.role || state.role !== "teacher") return <div className="p-8 text-center text-red-500">仅教师可访问</div>;

  const totalQ = results.length;
  const correct = results.filter((r: any) => r.is_correct).length;
  const rate = totalQ > 0 ? Math.round((correct / totalQ) * 100) : 0;
  const topics = [...new Set(results.map((r: any) => r.topic || "未分类"))];
  const byTopic = topics.map(t => {
    const items = results.filter((r: any) => (r.topic || "未分类") === t);
    return { topic: t, total: items.length, correct: items.filter((r: any) => r.is_correct).length, rate: items.length > 0 ? Math.round(items.filter((r: any) => r.is_correct).length / items.length * 100) : 0 };
  }).sort((a, b) => a.rate - b.rate);

  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      <div className="mb-6"><h1 className="text-2xl font-bold">阶段测验总览</h1><p className="text-sm text-[var(--color-text-secondary)] mt-1">全班学生测验成绩汇总</p></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[["测验总数", totalQ + "次", "📝", "bg-blue-50"], ["正确率", rate + "%", rate >= 70 ? "✅" : "💪", "bg-green-50"], ["正确数", correct, "🎯", "bg-amber-50"], ["知识点数", topics.length, "🏷️", "bg-purple-50"]].map(([l, v, i, c]) => (
          <div key={String(l)} className={c + " rounded-xl p-5"}><div className="flex justify-between"><span className="text-sm text-[var(--color-text-secondary)]">{l}</span><span className="text-lg">{i}</span></div><div className="text-2xl font-bold mt-2">{v}</div></div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden mb-6">
        <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">知识点掌握分析</h3></div>
        {byTopic.length === 0 ? <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">暂无测验数据</div> : (
          <div className="divide-y">
            {byTopic.map(t => (
              <div key={t.topic} className="flex items-center gap-4 px-5 py-4">
                <span className="text-sm font-medium w-32 truncate">{t.topic}</span>
                <div className="flex-1 bg-gray-200 rounded-full h-3"><div className={"h-3 rounded-full " + (t.rate >= 80 ? "bg-green-500" : t.rate >= 60 ? "bg-yellow-500" : "bg-red-500")} style={{ width: t.rate + "%" }} /></div>
                <span className="text-xs text-[var(--color-text-muted)] w-16 text-right">{t.correct}/{t.total}</span>
                <span className={"text-xs font-medium w-12 text-right " + (t.rate >= 80 ? "text-green-600" : t.rate >= 60 ? "text-yellow-600" : "text-red-600")}>{t.rate}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">最近测验记录</h3></div>
        {loading ? <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">加载中...</div> : results.length === 0 ? <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">暂无记录</div> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">{["学生","题目","回答","结果","知识点","时间"].map(h => <th key={h} className="text-left px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)]">{h}</th>)}</tr></thead>
            <tbody>{results.slice(0, 30).map((r: any) => (
              <tr key={r.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-2 text-xs">{r.user_email?.split("@")[0] || "—"}</td>
                <td className="px-4 py-2 text-xs max-w-[200px] truncate">{r.question}</td>
                <td className="px-4 py-2 text-xs">{r.student_answer || "—"}</td>
                <td className="px-4 py-2">{r.is_correct ? <span className="text-xs text-green-600">✓</span> : <span className="text-xs text-red-600">✗</span>}</td>
                <td className="px-4 py-2 text-xs">{r.topic || "—"}</td>
                <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">{new Date(r.created_at).toLocaleDateString("zh-CN")}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
