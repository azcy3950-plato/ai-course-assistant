"use client";

import React, { useState, useEffect } from "react";
import { useApp, getAuthToken } from "@/contexts/AppContext";
import { supabase } from "@/lib/supabase";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444"];
const keywords = ["暴雨重现期","SWMM模型","海绵城市","径流系数","LID","内涝成因","排水管网","年径流总量","设计标准","雨水调蓄","透水铺装","绿色屋顶","下沉式绿地","合流制","曼宁公式"];

export default function InsightsPage() {
  const { state } = useApp();
  const [records, setRecords] = useState<any[]>([]);
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState("week");

  useEffect(() => {
    (async () => {
      if (!state.role) return;
      try {
        const [r1, r2] = await Promise.all([
          fetch("/api/records", { headers: { Authorization: `Bearer ${getAuthToken()}` } }),
          fetch("/api/quiz-results", { headers: { Authorization: `Bearer ${getAuthToken()}` } }),
        ]);
        if (r1.ok) setRecords(await r1.json());
        if (r2.ok) setQuizzes(await r2.json());
      } catch (e) {}
      setLoading(false);
    })();
  }, [state.role]);

  if (!state.role) return <div className="p-8 text-center">请先登录</div>;

  // ── 全部图表基于真实数据聚合(records + quiz_results) ──
  const now = Date.now();
  const inRange = (iso?: string) => {
    if (!iso) return true;
    const t = new Date(iso).getTime();
    return timeRange === "week" ? now - t <= 7 * 86400000 : now - t <= 31 * 86400000;
  };
  const rangeRecords = records.filter(r => inRange(r.created_at));
  const rangeQuizzes = quizzes.filter(q => inRange(q.created_at));
  // 主题分布:按 records.topics 聚合(替代固定假数据)
  const topicCount = new Map<string, number>();
  rangeRecords.forEach((r: any) => (Array.isArray(r.topics) ? r.topics : []).forEach((t: string) => topicCount.set(String(t), (topicCount.get(String(t)) || 0) + 1)));
  const moduleData = [...topicCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, value]) => ({ name, value }));
  if (moduleData.length === 0) moduleData.push({ name: "暂无记录", value: 1 });
  // 每日提问(按星期,真实 created_at)
  const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const dailyCount = new Array(7).fill(0);
  rangeRecords.forEach((r: any) => { if (r.created_at) dailyCount[new Date(r.created_at).getDay()]++; });
  const dailyData = weekDays.map((day, i) => ({ day, questions: dailyCount[i] }));
  // 学习进步曲线:按最近 4 周聚合提问数与小测正确率
  const trendData = [3, 2, 1, 0].map((w) => {
    const start = now - (w + 1) * 7 * 86400000, end = now - w * 7 * 86400000;
    const q = records.filter(r => { const t = r.created_at ? new Date(r.created_at).getTime() : 0; return t >= start && t < end; }).length;
    const qz = quizzes.filter(x => { const t = x.created_at ? new Date(x.created_at).getTime() : 0; return t >= start && t < end; });
    const rate = qz.length ? Math.round((qz.filter(x => x.is_correct).length / qz.length) * 100) : 0;
    return { week: `近${4 - w}周`, 提问: q, 正确率: rate };
  });
  // 学习关键词:records.keywords 聚合去重(替代固定列表)
  const keywordSet = new Set<string>();
  rangeRecords.forEach((r: any) => (Array.isArray(r.keywords) ? r.keywords : []).forEach((k: string) => keywordSet.add(String(k))));
  if (keywordSet.size === 0) keywordSet.add("暂无关键词(先提问试试)");
  const keywords = [...keywordSet].slice(0, 20);
  // 统计卡:全部真实
  const quizRate = quizzes.length ? Math.round((quizzes.filter(q => q.is_correct).length / quizzes.length) * 100) : 0;
  const stats = [
    ["提问总数", records.length, "💬", "bg-blue-50"],
    ["涉及知识点", topicCount.size, "📚", "bg-green-50"],
    [timeRange === "week" ? "本周提问" : "本月提问", rangeRecords.length, "⏱️", "bg-purple-50"],
    ["小测正确率", quizRate + "%", "✅", "bg-amber-50"],
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI 学习洞察</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">自动分析学习轨迹 · 发现知识盲区 · 推荐学习方向</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {[{ k: "week", l: "本周" }, { k: "month", l: "本月" }].map(t => (
            <button key={t.k} onClick={() => setTimeRange(t.k)}
              className={"px-3 py-1.5 rounded-md text-xs font-medium transition-colors " + (timeRange === t.k ? "bg-white shadow-sm text-[var(--color-text)]" : "text-[var(--color-text-secondary)]")}>{t.l}</button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {stats.map(([l, v, i, c]) => (
          <div key={String(l)} className={c + " rounded-xl p-5"}>
            <div className="flex justify-between"><span className="text-sm text-[var(--color-text-secondary)]">{l}</span><span className="text-lg">{i}</span></div>
            <div className="text-2xl font-bold mt-2">{v}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
          <h3 className="text-sm font-bold mb-4">📊 学习模块分布</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={moduleData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => name + " " + ((percent ?? 0) * 100).toFixed(0) + "%"}>
                {moduleData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
          <h3 className="text-sm font-bold mb-4">📈 每日提问趋势</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dailyData}>
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="questions" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
          <h3 className="text-sm font-bold mb-4">📉 学习进步曲线</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData}>
              <XAxis dataKey="week" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Line type="monotone" dataKey="正确率" stroke="#10b981" strokeWidth={2} />
              <Line type="monotone" dataKey="提问" stroke="#3b82f6" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
          <h3 className="text-sm font-bold mb-4">🏷️ 学习关键词</h3>
          <div className="flex flex-wrap gap-2">
            {keywords.map(k => (
              <span key={k} className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: "hsl(" + Math.floor(Math.random() * 40 + 200) + ",60%,95%)", color: "var(--color-primary)" }}>{k}</span>
            ))}
          </div>
        </div>
      </div>

      {/* AI Recommendations(基于真实薄弱点:正确率最低的小测主题优先推荐) */}
      <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
        <h3 className="text-sm font-bold mb-4">🎯 AI 推荐下一步</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(() => {
            const wrong = new Map<string, number>();
            quizzes.filter(q => !q.is_correct).forEach((q: any) => wrong.set(String(q.topic || "综合"), (wrong.get(String(q.topic || "综合")) || 0) + 1));
            const weak = [...wrong.entries()].sort((a, b) => b[1] - a[1])[0];
            const base = quizzes.length === 0
              ? ["完成一次知识问答,AI 将分析你的学习轨迹","在引导学习中开启一次苏格拉底式对话","进入电子沙盘体验 5/10/50/100 年一遇暴雨推演","完成小测检验当前掌握程度"]
              : [
                  weak ? `重点复习「${weak[0]}」,该主题答错 ${weak[1]} 次` : "保持当前学习节奏,继续提问巩固",
                  "在引导学习中开启一次苏格拉底式对话",
                  "进入电子沙盘体验 5/10/50/100 年一遇暴雨推演",
                  "完成小测检验当前掌握程度",
                ];
            return base.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl text-sm hover:bg-blue-100 transition-colors cursor-pointer">
                <span className="text-lg">{["📖","📝","🔬","🗺️"][i]}</span>
                <span className="text-[var(--color-text)]">{r}</span>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}
