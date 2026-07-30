"use client";

import React, { useState, useEffect } from "react";
import { useApp } from "@/contexts/AppContext";
import { supabase } from "@/lib/supabase";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444"];
const keywords = ["暴雨重现期","SWMM模型","海绵城市","径流系数","LID","内涝成因","排水管网","年径流总量","设计标准","雨水调蓄","透水铺装","绿色屋顶","下沉式绿地","合流制","曼宁公式"];

export default function InsightsPage() {
  const { state } = useApp();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState("week");

  useEffect(() => {
    (async () => {
      if (!state.role) return;
      const { data: s } = await supabase.auth.getSession();
      const em = s.session?.user?.email || "";
      if (!em) { setLoading(false); return; }
      try {
        const r = await fetch("/api/records?email=" + encodeURIComponent(em));
        if (r.ok) setRecords(await r.json());
      } catch (e) {}
      setLoading(false);
    })();
  }, [state.role]);

  if (!state.role) return <div className="p-8 text-center">请先登录</div>;

  // Module distribution data
  const moduleData = [
    { name: "课程知识", value: records.length || 45 },
    { name: "案例分析", value: Math.round(records.length * 0.5) || 25 },
    { name: "引导学习", value: Math.round(records.length * 0.3) || 18 },
    { name: "电子沙盘", value: Math.round(records.length * 0.2) || 12 },
  ];

  const dailyData = [
    { day: "周一", questions: 5 }, { day: "周二", questions: 8 }, { day: "周三", questions: 3 },
    { day: "周四", questions: 7 }, { day: "周五", questions: 6 }, { day: "周六", questions: 2 }, { day: "周日", questions: 1 },
  ];

  const trendData = [
    { week: "W1", 提问: 12, 正确率: 65 }, { week: "W2", 提问: 18, 正确率: 72 },
    { week: "W3", 提问: 15, 正确率: 78 }, { week: "W4", 提问: 22, 正确率: 82 },
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
        {[["提问总数", records.length || 32, "💬", "bg-blue-50"], ["涉及知识点", keywords.length, "📚", "bg-green-50"], ["本周学习", "8h", "⏱️", "bg-purple-50"], ["正确率", "78%", "✅", "bg-amber-50"]].map(([l, v, i, c]) => (
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
              <Pie data={moduleData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => name + " " + (percent * 100).toFixed(0) + "%"}>
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

      {/* AI Recommendations */}
      <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
        <h3 className="text-sm font-bold mb-4">🎯 AI 推荐下一步</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {["深入学习 SWMM 模型参数设置与率定方法","完成暴雨强度公式推导专项练习","探索不同海绵设施组合方案的径流削减效果","运行一次完整的城市内涝情景模拟"].map((r, i) => (
            <div key={i} className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl text-sm hover:bg-blue-100 transition-colors cursor-pointer">
              <span className="text-lg">{["📖","📝","🔬","🗺️"][i]}</span>
              <span className="text-[var(--color-text)]">{r}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
