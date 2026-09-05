'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useApp, getAuthToken } from "@/contexts/AppContext";
import { TASK_TYPE_META, TASK_STATUS_META } from "@/lib/task-ui";

// ══════════════ UNAUTHENTICATED LANDING ══════════════
function LandingPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8 text-center">
      <div className="mt-20 mb-8">
        <span className="text-6xl">🎓</span>
        <h1 className="text-3xl font-bold text-[var(--color-text)] mt-4 mb-3">
          AI 课程助教
        </h1>
        <p className="text-[var(--color-text-secondary)] mb-8 max-w-xl mx-auto leading-relaxed">
          城市排水与内涝防治智能教学平台 — 统一知识库智能体、引导思考智能体、电子沙盘三位一体
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/login"
            className="px-6 py-3 bg-[var(--color-primary)] text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
          >
            登录
          </Link>
          <Link
            href="/signup"
            className="px-6 py-3 border border-[var(--color-border)] rounded-xl font-medium text-[var(--color-text)] hover:bg-gray-50 transition-colors"
          >
            注册
          </Link>
        </div>
      </div>
    </div>
  );
}

// Student module cards
const studentModules = [
  {
    href: '/knowledge',
    icon: '📚',
    title: '知识问答',
    desc: '查询课程知识、案例与文献，AI 精准回答并标注引用来源',
    color: 'from-blue-500 to-blue-600',
    bgColor: 'bg-blue-50',
    features: ['三栏式布局', '引用来源标注', '历史对话管理'],
  },
  {
    href: '/guided',
    icon: '💡',
    title: '引导学习',
    desc: '通过多轮提问引导学生深度思考，内化专业知识体系',
    color: 'from-green-500 to-emerald-600',
    bgColor: 'bg-green-50',
    features: ['多轮引导对话', '逐级提示系统', '学习进度追踪'],
  },
  {
    href: '/sandbox',
    icon: '🗺️',
    title: '电子沙盘',
    desc: '静态场景展示与动态内涝模拟，直观理解城市排水系统',
    color: 'from-purple-500 to-indigo-600',
    bgColor: 'bg-purple-50',
    features: ['地图可视化', '参数调节模拟', '时间轴回放'],
  },
];

// Teacher module cards
const teacherModules = [
  {
    href: '/teacher',
    icon: '📤',
    title: '资料管理',
    desc: '上传教材、PPT、案例和文献，管理知识库内容',
    color: 'from-orange-500 to-red-500',
    bgColor: 'bg-orange-50',
  },
  {
    href: '/teacher',
    icon: '📊',
    title: '学生统计',
    desc: '查看学生使用情况、学习进度和沙盘实验数据',
    color: 'from-teal-500 to-cyan-600',
    bgColor: 'bg-teal-50',
  },
  {
    href: '/sandbox',
    icon: '⚙️',
    title: '沙盘管理',
    desc: '配置沙盘数据、导入地形和管网图层',
    color: 'from-indigo-500 to-blue-600',
    bgColor: 'bg-indigo-50',
  },
];

export default function HomePage() {
  const { state } = useApp();
  const [stats, setStats] = useState({ docCount: 0, quizTotal: 0, quizRate: 0, recordCount: 0 });
  // 学生首页：待办任务、教师反馈、最近学习事件（真实数据）
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);
  const [latestFeedback, setLatestFeedback] = useState<any[]>([]);
  const [recentEvents, setRecentEvents] = useState<any[]>([]);

  useEffect(() => {
    if (!state.role) return;
    (async () => {
      try {
        // Fetch documents count(经 /api/storage,仅教师可见)
        let docCount = 0;
        if (state.role === "teacher") {
          const dRes = await fetch('/api/storage', { headers: { Authorization: `Bearer ${getAuthToken()}` } });
          if (dRes.ok) { const docs = await dRes.json(); docCount = Array.isArray(docs) ? docs.length : 0; }
        }
        // Fetch quiz stats(经 /api/quiz-results,登录查询自己的)
        const qRes = await fetch('/api/quiz-results', { headers: { Authorization: `Bearer ${getAuthToken()}` } });
        let quizTotal = 0, quizRate = 0;
        if (qRes.ok) { const qr = await qRes.json(); quizTotal = qr.length; quizRate = qr.length > 0 ? Math.round(qr.filter((q: any) => q.is_correct).length / qr.length * 100) : 0; }
        // Fetch records count
        const rRes = await fetch("/api/records", { headers: { Authorization: `Bearer ${getAuthToken()}` } });
        let recordCount = 0;
        if (rRes.ok) { const recs = await rRes.json(); recordCount = recs.length; }
        setStats({ docCount, quizTotal, quizRate, recordCount });
        // 学生：待办任务 + 最新教师反馈 + 最近学习事件
        if (state.role === "student") {
          const [tRes, fRes, eRes] = await Promise.all([
            fetch("/api/tasks", { headers: { Authorization: `Bearer ${getAuthToken()}` } }),
            fetch("/api/feedback", { headers: { Authorization: `Bearer ${getAuthToken()}` } }),
            fetch("/api/learning-events", { headers: { Authorization: `Bearer ${getAuthToken()}` } }),
          ]);
          if (tRes.ok) {
            const tasks = await tRes.json();
            const prio: Record<string, number> = { REVISION_REQUIRED: 0, OVERDUE: 1, IN_PROGRESS: 2, TODO: 3 };
            setPendingTasks(
              tasks
                .filter((t: any) => ["TODO", "IN_PROGRESS", "REVISION_REQUIRED", "OVERDUE"].includes(t.effective_status))
                .sort((a: any, b: any) => (prio[a.effective_status] ?? 9) - (prio[b.effective_status] ?? 9))
                .slice(0, 3),
            );
          }
          if (fRes.ok) {
            const fb = await fRes.json();
            setLatestFeedback(Array.isArray(fb) ? fb.slice(0, 3) : []);
          }
          if (eRes.ok) {
            const events = await eRes.json();
            setRecentEvents(Array.isArray(events) ? events.slice(0, 3) : []);
          }
        }
      } catch (e) {}
    })();
  }, [state.role]);

  // ── Authenticated check ──
  if (!state.role) {
    return <LandingPage />;
  }

  const isStudent = state.role === 'student';
  const modules = isStudent ? studentModules : teacherModules;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Dashboard Header */}
      <div className="bg-white rounded-2xl border border-[var(--color-border)] p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{isStudent ? '欢迎回来，' + state.userName : '教师工作台'}</h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">{isStudent ? '继续你的学习之旅' : '管理课程与学生学习'}</p>
          </div>
          <div className="text-5xl">{isStudent ? '🧑‍🎓' : '👨‍🏫'}</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(isStudent
            ? [["问答次数",stats.recordCount+"次","💬","bg-blue-50"],["小测正确率",stats.quizRate+"%","✅","bg-green-50"],["小测次数",stats.quizTotal+"次","🏷️","bg-purple-50"],["学习状态",stats.quizRate>=70?"良好":"加油","⏱️","bg-amber-50"]]
            : [["文档总数",stats.docCount,"📄","bg-blue-50"],["问答次数",stats.recordCount+"次","💬","bg-green-50"],["小测正确率",stats.quizRate+"%","📊","bg-purple-50"],["已处理文档",stats.docCount,"📋","bg-amber-50"]]
          ).map(([label,val,icon,bg]) => (
            <div key={String(label)} className={bg + " rounded-xl p-4"}>
              <div className="flex justify-between items-center"><span className="text-xs text-[var(--color-text-secondary)]">{label}</span><span className="text-sm">{icon}</span></div>
              <div className="text-xl font-bold mt-1">{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 学生：待办任务与教师反馈（真实数据） */}
      {isStudent && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[var(--color-text)]">⏳ 待办任务</h3>
              <Link href="/tasks" className="text-xs text-[var(--color-primary)] hover:underline">全部 →</Link>
            </div>
            {pendingTasks.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)] py-3 text-center">暂无待办任务</p>
            ) : (
              <div className="space-y-2">
                {pendingTasks.map((t) => (
                  <Link key={t.id} href={`/tasks/${t.id}`}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 hover:border-[var(--color-primary)] transition-colors ${t.effective_status === "REVISION_REQUIRED" ? "border-red-200 bg-red-50" : "border-[var(--color-border)]"}`}>
                    <span className="text-sm">{TASK_TYPE_META[t.type as keyof typeof TASK_TYPE_META]?.icon || "📋"}</span>
                    <span className="text-xs font-medium text-[var(--color-text)] flex-1 truncate">{t.title}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${TASK_STATUS_META[t.effective_status as keyof typeof TASK_STATUS_META]?.cls || "bg-gray-100 text-gray-600"}`}>
                      {TASK_STATUS_META[t.effective_status as keyof typeof TASK_STATUS_META]?.label || t.effective_status}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[var(--color-text)]">💬 最新教师反馈</h3>
              <Link href="/tasks" className="text-xs text-[var(--color-primary)] hover:underline">全部 →</Link>
            </div>
            {latestFeedback.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)] py-3 text-center">暂无教师反馈</p>
            ) : (
              <div className="space-y-2">
                {latestFeedback.map((f) => (
                  <Link key={f.id} href={`/tasks/${f.task_id}`} className="block rounded-lg border border-[var(--color-border)] px-3 py-2 hover:border-[var(--color-primary)] transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--color-text)] truncate">{f.task_title}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${f.status === "revision_required" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>
                        {f.status === "revision_required" ? "需要修改" : "已通过"}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 line-clamp-2">{f.content}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Welcome subtitle */}
      <p className="text-[var(--color-text-secondary)] max-w-2xl mx-auto mb-6 text-center">
          {isStudent
            ? '选择下方模块开始学习。AI 助教将帮助你掌握城市排水与内涝防治的核心知识。'
            : '管理课程资料、知识库和沙盘数据，查看学生学习情况。'}
        </p>

      {/* Module Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        {modules.map((mod, i) => (
          <Link
            key={i}
            href={mod.href}
            className="group bg-white rounded-2xl border border-[var(--color-border)] p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
          >
            <div
              className={`w-14 h-14 rounded-xl ${mod.bgColor} flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform`}
            >
              {mod.icon}
            </div>
            <h2 className="text-lg font-bold text-[var(--color-text)] mb-2">
              {mod.title}
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4 leading-relaxed">
              {mod.desc}
            </p>
            {'features' in mod && (
              <div className="flex flex-wrap gap-1.5">
                {(mod as typeof studentModules[0]).features.map((f, j) => (
                  <span
                    key={j}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-[var(--color-text-secondary)]"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>

      {/* Recent Records (student only, 真实学习事件) */}
      {isStudent && recentEvents.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-[var(--color-text)]">
              📋 最近学习记录
            </h3>
            <Link
              href="/records"
              className="text-sm text-[var(--color-primary)] hover:underline"
            >
              查看全部 →
            </Link>
          </div>
          <div className="bg-white rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
            {recentEvents.slice(0, 3).map((e: any) => (
              <div key={e.id} className="flex items-center gap-4 px-5 py-3.5">
                <span className="text-xl">
                  {String(e.type || '').includes('KNOWLEDGE') ? '📚' : String(e.type || '').includes('GUIDED') ? '💡' : '🗺️'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)] truncate">
                    {e.title}
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)] truncate">
                    {e.summary}
                  </div>
                </div>
                <div className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                  {new Date(e.created_at).toLocaleDateString('zh-CN')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
