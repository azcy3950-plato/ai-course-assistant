"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getAuthToken } from "@/contexts/AppContext";
import { formatDeadline } from "@/lib/task-ui";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, LineChart, Line,
} from "recharts";

const EVENT_META: Record<string, string> = {
  KNOWLEDGE_COMPLETED: "📚",
  PRACTICE_COMPLETED: "✏️",
  PRACTICE_CORRECTED: "✅",
  GUIDED_COMPLETED: "💡",
  SIMULATION_SUBMITTED: "🗺️",
  TASK_COMPLETED: "🏁",
  TASK_STARTED: "▶️",
  TASK_SUBMITTED: "📤",
  TEACHER_FEEDBACK_RECEIVED: "💬",
};

function masteryColor(m: number | null) {
  const v = Number(m ?? 0);
  if (v >= 80) return "bg-green-500";
  if (v >= 60) return "bg-yellow-500";
  return "bg-red-400";
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function DashboardTab() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/dashboard", { headers: { Authorization: "Bearer " + getAuthToken() } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "加载失败");
      setData(d);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[40vh] text-[var(--color-text-muted)]">加载中...</div>;
  }
  if (error) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-red-500 mb-4">{error}</p>
        <button onClick={load} className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-gray-50">重试</button>
      </div>
    );
  }

  const { stats, classProgress, trend, quizTopics, weakStudents, overdueTasks, recentEvents } = data;

  // 整页空态：无班级则无任何聚合意义
  if (stats.classCount === 0) {
    return (
      <div className="bg-white rounded-xl border border-[var(--color-border)] p-16 text-center">
        <p className="text-3xl mb-3">🏠</p>
        <p className="text-sm text-[var(--color-text-muted)]">暂无班级与学生，请先在「🏫 班级」tab 创建班级并添加学生</p>
      </div>
    );
  }

  // 图表数据（全部真实聚合；无数据守卫）
  const classChart = (classProgress || []).filter((c: any) => c.total > 0)
    .map((c: any) => ({ name: c.name, 已完成: c.done, 需修改: c.revision }));
  const trendAllZero = (trend || []).every((t: any) => t.events === 0 && t.students === 0);
  const quizChart = (quizTopics || []).filter((t: any) => t.total >= 2).slice(0, 8)
    .map((t: any) => ({ topic: t.topic, 正确率: Math.round((t.correct / t.total) * 100) }));

  const completionRate = stats.taskTotal > 0 ? Math.round((stats.taskDone / stats.taskTotal) * 100) + "%" : "—";

  const statCards: [string, string | number, string, string][] = [
    ["班级数", stats.classCount, "🏫", "bg-blue-50"],
    ["学生数", stats.studentCount, "🧑‍🎓", "bg-green-50"],
    ["任务完成率", stats.taskTotal > 0 ? completionRate : "—", "✅", "bg-emerald-50"],
    ["待批阅提交", stats.pending, "📥", "bg-amber-50"],
    ["需修改", stats.revision, "🔁", "bg-orange-50"],
    ["逾期任务项", stats.overdue, "⏰", "bg-red-50"],
    ["近7天活跃学生", stats.active7d, "🔥", "bg-purple-50"],
  ];

  return (
    <div>
      <p className="text-[10px] text-[var(--color-text-muted)] mb-4">
        数据来自真实学习记录与测验结果，范围限定为您的班级学生；含固定演示账号（student01-12@demo.edu.cn）产生的可复现演示数据
      </p>

      {/* 统计卡 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {statCards.map(([l, v, i, c]) => (
          <div key={String(l)} className={`${c} rounded-xl p-4`}>
            <div className="flex justify-between">
              <span className="text-xs opacity-70">{String(l)}</span><span className="text-sm">{String(i)}</span>
            </div>
            <div className="text-xl font-bold mt-1">{String(v)}</div>
            {l === "任务完成率" && stats.taskTotal > 0 && (
              <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{stats.taskDone}/{stats.taskTotal} 项</div>
            )}
          </div>
        ))}
      </div>

      {/* 图表区 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4">📊 班级任务完成度对比</h3>
          {classChart.length === 0 ? (
            <p className="py-10 text-center text-xs text-[var(--color-text-muted)]">暂无班级任务数据</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[320px]">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={classChart}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="已完成" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="需修改" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4">📈 近 14 天学习动态</h3>
          {trendAllZero ? (
            <p className="py-10 text-center text-xs text-[var(--color-text-muted)]">近 14 天暂无学习活动，学生开始学习后自动生成</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend}>
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="events" name="学习事件" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                <Line type="monotone" dataKey="students" name="活跃学生" stroke="#3b82f6" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 md:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">🎯 小测正确率（按知识点）</h3>
          <p className="text-[10px] text-[var(--color-text-muted)] mb-4">按正确率升序排列，样本不足 2 题的 topic 已隐藏</p>
          {quizChart.length === 0 ? (
            <p className="py-10 text-center text-xs text-[var(--color-text-muted)]">暂无小测数据，学生完成小测后自动生成</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[360px]">
                <ResponsiveContainer width="100%" height={Math.max(140, quizChart.length * 40)}>
                  <BarChart data={quizChart} layout="vertical" margin={{ left: 10, right: 30 }}>
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="topic" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => v + "%"} />
                    <Bar dataKey="正确率" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 列表区 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">🎯 薄弱学生 Top5</h3>
          </div>
          {weakStudents.length === 0 ? (
            <p className="p-8 text-center text-xs text-[var(--color-text-muted)]">暂无掌握度数据，学生开始学习后自动生成</p>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {weakStudents.map((s: any) => (
                <button key={s.user_email} onClick={() => router.push("/teacher/students/" + encodeURIComponent(s.user_email))}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--color-text)] truncate">{s.name || s.user_email}</span>
                    <span className="text-xs text-[var(--color-text-muted)] shrink-0">{s.nodes} 个知识点</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className={`${masteryColor(s.avg_mastery)} h-1.5 rounded-full`} style={{ width: Math.min(100, Number(s.avg_mastery ?? 0)) + "%" }} />
                    </div>
                    <span className="text-xs text-[var(--color-text-secondary)] shrink-0">平均掌握度 {Number(s.avg_mastery)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">⏰ 逾期任务速览</h3>
          </div>
          {overdueTasks.length === 0 ? (
            <p className="p-8 text-center text-xs text-[var(--color-text-muted)]">暂无逾期任务</p>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {overdueTasks.map((t: any) => (
                <button key={t.id} onClick={() => router.push("/teacher/tasks/" + t.id)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-[var(--color-text)] truncate">{t.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500 font-medium shrink-0">{t.overdue} 人逾期</span>
                  </div>
                  <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                    {t.class_name || "个人任务"} · 截止 {formatDeadline(t.deadline)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">🕐 最近动态</h3>
          </div>
          {recentEvents.length === 0 ? (
            <p className="p-8 text-center text-xs text-[var(--color-text-muted)]">暂无学习动态，学生开始学习后自动生成</p>
          ) : (
            <div className="divide-y divide-[var(--color-border)] max-h-[400px] overflow-y-auto">
              {recentEvents.map((e: any) => (
                <div key={e.id} className="px-4 py-2.5">
                  <div className="flex items-start gap-2">
                    <span className="text-sm shrink-0">{EVENT_META[e.type] || "📌"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-[var(--color-text)] truncate">
                        <span className="font-medium">{e.student_name || e.user_email}</span> {e.title}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{formatTime(e.created_at)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
