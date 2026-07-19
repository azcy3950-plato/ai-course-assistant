'use client';

import React from 'react';
import Link from 'next/link';
import { useApp } from '@/contexts/AppContext';
import { useLearning } from '@/contexts/LearningContext';

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
  const { state: learningState } = useLearning();
  // ── Authenticated check ──
  if (!state.role) {
    return <LandingPage />;
  }

  const isStudent = state.role === 'student';
  const modules = isStudent ? studentModules : teacherModules;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Welcome */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-[var(--color-text)] mb-3">
          {isStudent ? '欢迎回来，' + state.userName : '教师工作台'}
        </h1>
        <p className="text-[var(--color-text-secondary)] max-w-2xl mx-auto">
          {isStudent
            ? '选择下方模块开始学习。AI 助教将帮助你掌握城市排水与内涝防治的核心知识。'
            : '管理课程资料、知识库和沙盘数据，查看学生学习情况。'}
        </p>
      </div>

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

      {/* Recent Records (student only) */}
      {isStudent && learningState.records.length > 0 && (
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
            {learningState.records.slice(0, 3).map(record => (
              <div key={record.id} className="flex items-center gap-4 px-5 py-3.5">
                <span className="text-xl">
                  {record.type === 'knowledge' ? '📚' : record.type === 'guided' ? '💡' : '🗺️'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)] truncate">
                    {record.title}
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)] truncate">
                    {record.summary}
                  </div>
                </div>
                <div className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                  {new Date(record.timestamp).toLocaleDateString('zh-CN')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
