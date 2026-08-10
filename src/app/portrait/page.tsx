"use client";

import React, { useState, useEffect } from "react";
import { useApp, getAuthToken } from "@/contexts/AppContext";
import { supabase } from "@/lib/supabase";

export default function PortraitPage() {
  const { state } = useApp();
  const [quizStats, setQuizStats] = useState({ total: 0, correct: 0, rate: 0 });
  const [topics, setTopics] = useState<{ topic: string; correct: number; total: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!state.role) return;
      const { data: s } = await supabase.auth.getSession();
      const em = s.session?.user?.email || "";
      if (!em) { setLoading(false); return; }
      try {
        const r1 = await fetch("/api/records?email=" + encodeURIComponent(em), { headers: { Authorization: `Bearer ${getAuthToken()}` } });
        const records = r1.ok ? await r1.json() : [];

        // Quiz stats are on client side for now
        const qrRes = await fetch("/api/quiz-results?email=" + encodeURIComponent(em));
        const qr = qrRes.ok ? await qrRes.json() : [];
        setQuizStats({ total: qr.length, correct: qr.filter((q: any) => q.is_correct).length, rate: qr.length > 0 ? Math.round(qr.filter((q: any) => q.is_correct).length / qr.length * 100) : 0 });

        // Topic breakdown
        const topicMap: Record<string, { correct: number; total: number }> = {};
        qr.forEach((q: any) => {
          const t = q.topic || "未分类";
          if (!topicMap[t]) topicMap[t] = { correct: 0, total: 0 };
          topicMap[t].total++;
          if (q.is_correct) topicMap[t].correct++;
        });
        setTopics(Object.entries(topicMap).map(([topic, v]) => ({ topic, ...v })));
      } catch (e) {}
      setLoading(false);
    })();
  }, [state.role]);

  if (!state.role) return <div className="p-8 text-center">请先登录</div>;
  if (loading) return <div className="p-8 text-center text-[var(--color-text-muted)]">加载中...</div>;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">学习画像</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">个人知识掌握分析</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[["小测总数", quizStats.total + "次", "📝", "bg-blue-50"], ["正确率", quizStats.rate + "%", quizStats.rate >= 70 ? "✅" : "💪", "bg-green-50"], ["涉及知识点", topics.length + "个", "🏷️", "bg-purple-50"], ["学习状态", quizStats.rate >= 70 ? "良好" : "需加强", "📊", "bg-amber-50"]].map(([l, v, i, c]) => (
          <div key={String(l)} className={c + " rounded-xl p-5"}>
            <div className="flex justify-between"><span className="text-sm text-[var(--color-text-secondary)]">{l}</span><span className="text-lg">{i}</span></div>
            <div className="text-2xl font-bold mt-2">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
          <h3 className="text-sm font-bold mb-4">📊 知识点掌握度</h3>
          {topics.length === 0 ? (
            <div className="text-center py-8 text-sm text-[var(--color-text-muted)]">完成阶段检测后将显示知识点分析</div>
          ) : (
            <div className="space-y-3">
              {topics.map((t) => {
                const rate = Math.round((t.correct / t.total) * 100);
                return (
                  <div key={t.topic} className="flex items-center gap-3 text-sm">
                    <span className="w-24 truncate">{t.topic}</span>
                    <div className="flex-1 bg-gray-200 rounded-full h-3">
                      <div className={"h-3 rounded-full " + (rate >= 80 ? "bg-green-500" : rate >= 60 ? "bg-yellow-500" : "bg-red-500")} style={{ width: rate + "%" }} />
                    </div>
                    <span className="text-xs text-[var(--color-text-muted)] w-12 text-right">{t.correct}/{t.total}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
          <h3 className="text-sm font-bold mb-4">🎯 薄弱知识点</h3>
          {topics.filter(t => Math.round((t.correct/t.total)*100) < 70).length === 0 ? (
            <div className="text-center py-8 text-sm text-green-600">🎉 暂无薄弱点，继续保持！</div>
          ) : (
            <div className="space-y-3">
              {topics.filter(t => Math.round((t.correct/t.total)*100) < 70).map(t => (
                <div key={t.topic} className="flex items-center gap-3 p-3 bg-red-50 rounded-lg text-sm">
                  <span>⚠️</span>
                  <span className="flex-1 font-medium">{t.topic}</span>
                  <span className="text-xs text-red-600">正确率 {Math.round((t.correct/t.total)*100)}%</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-xs font-bold mb-2 text-[var(--color-text-secondary)]">💡 学习建议</h4>
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              {quizStats.rate >= 80 ? "掌握情况良好，建议进入电子沙盘进行情景模拟训练，将理论应用于实践。" :
               quizStats.rate >= 60 ? "基础知识掌握较好，建议对薄弱知识点进行针对性复习，使用引导学习模式加深理解。" :
               "建议返回知识问答，针对薄弱知识点重新学习基础概念，然后完成引导学习模块。加油！💪"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
