'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { getAuthToken } from "@/contexts/AppContext";

// 统一时间线条目：来自学习事件 + 问答记录 + 小测结果（全部真实数据）
interface TimelineItem {
  id: string;
  category: 'knowledge' | 'guided' | 'sandbox' | 'quiz';
  title: string;
  summary: string;
  timestamp: number;
}

const categoryConfig: Record<TimelineItem['category'], { icon: string; label: string; color: string; dot: string }> = {
  knowledge: { icon: '📚', label: '知识问答', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  guided: { icon: '💡', label: '引导学习', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  sandbox: { icon: '🗺️', label: '任务与沙盘', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  quiz: { icon: '📝', label: '阶段小测', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
};

function eventCategory(type: string): TimelineItem['category'] {
  if (type.includes('KNOWLEDGE')) return 'knowledge';
  if (type.includes('GUIDED')) return 'guided';
  return 'sandbox'; // SIMULATION/TASK/PRACTICE/TEACHER_FEEDBACK 等
}

export default function RecordsPage() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [filter, setFilter] = useState<TimelineItem['category'] | 'all'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const headers = { Authorization: `Bearer ${getAuthToken()}` };
        const [eRes, rRes, qRes] = await Promise.all([
          fetch('/api/learning-events', { headers }),
          fetch('/api/records', { headers }),
          fetch('/api/quiz-results', { headers }),
        ]);
        const merged: TimelineItem[] = [];
        if (eRes.ok) {
          const events = await eRes.json();
          for (const e of events) {
            merged.push({
              id: `e-${e.id}`,
              category: eventCategory(e.type || ''),
              title: e.title || '学习事件',
              summary: e.summary || '',
              timestamp: new Date(e.created_at).getTime(),
            });
          }
        }
        if (rRes.ok) {
          const records = await rRes.json();
          for (const r of records) {
            merged.push({
              id: `r-${r.id}`,
              category: 'knowledge',
              title: r.question || '知识问答',
              summary: r.answer_summary || '',
              timestamp: new Date(r.created_at).getTime(),
            });
          }
        }
        if (qRes.ok) {
          const quizzes = await qRes.json();
          for (const q of quizzes) {
            merged.push({
              id: `q-${q.id}`,
              category: 'quiz',
              title: q.question || '阶段小测',
              summary: q.is_correct ? '✓ 回答正确' : '✗ 回答错误，已记入错题本',
              timestamp: new Date(q.created_at).getTime(),
            });
          }
        }
        merged.sort((a, b) => b.timestamp - a.timestamp);
        setItems(merged);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredItems = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.category === filter)),
    [items, filter],
  );

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const today = new Date();
    const diffDays = Math.floor((today.getTime() - d.getTime()) / 86400000);
    const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    if (diffDays === 0) return `今天 ${timeStr}`;
    if (diffDays === 1) return `昨天 ${timeStr}`;
    if (diffDays < 7) return `${diffDays}天前 ${timeStr}`;
    return dateStr;
  };

  // Group by date
  const groupedItems = useMemo(() => {
    const groups: { date: string; items: TimelineItem[] }[] = [];
    const seenDates = new Set<string>();
    for (const item of filteredItems) {
      const dateStr = new Date(item.timestamp).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      });
      if (!seenDates.has(dateStr)) {
        seenDates.add(dateStr);
        groups.push({ date: dateStr, items: [] });
      }
      groups[groups.length - 1].items.push(item);
    }
    return groups;
  }, [filteredItems]);

  // Stats
  const stats = useMemo(() => {
    const count = (c: TimelineItem['category']) => items.filter((i) => i.category === c).length;
    return {
      total: items.length,
      knowledge: count('knowledge'),
      guided: count('guided'),
      sandbox: count('sandbox'),
      quiz: count('quiz'),
    };
  }, [items]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">学习记录</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          记录你的所有学习活动，持续追踪学习进度
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-4 text-center">
          <div className="text-2xl font-bold text-[var(--color-text)]">{stats.total}</div>
          <div className="text-xs text-[var(--color-text-muted)]">总记录数</div>
        </div>
        <div className="bg-blue-50 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-blue-700">{stats.knowledge}</div>
          <div className="text-xs text-blue-600">知识查询</div>
        </div>
        <div className="bg-green-50 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-green-700">{stats.guided}</div>
          <div className="text-xs text-green-600">引导学习</div>
        </div>
        <div className="bg-purple-50 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-purple-700">{stats.sandbox + stats.quiz}</div>
          <div className="text-xs text-purple-600">任务与沙盘 · 小测</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {([
          { key: 'all' as const, label: '全部', icon: '📋' },
          { key: 'knowledge' as const, label: '知识问答', icon: '📚' },
          { key: 'guided' as const, label: '引导学习', icon: '💡' },
          { key: 'sandbox' as const, label: '任务与沙盘', icon: '🗺️' },
          { key: 'quiz' as const, label: '阶段小测', icon: '📝' },
        ]).map(item => (
          <button
            key={item.key}
            onClick={() => setFilter(item.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === item.key
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-gray-50'
            }`}
          >
            <span className="mr-1">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="p-12 text-center text-sm text-[var(--color-text-muted)]">加载中...</div>
      ) : groupedItems.length === 0 ? (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
          <div className="text-5xl mb-4">📭</div>
          <h3 className="text-lg font-bold text-[var(--color-text)] mb-2">暂无学习记录</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            开始使用知识问答、引导学习或电子沙盘后，记录将显示在这里
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupedItems.map((group, gi) => (
            <div key={gi}>
              <div className="text-sm font-bold text-[var(--color-text)] mb-3 flex items-center gap-2">
                <span>📅</span>
                {group.date}
              </div>

              <div className="relative pl-8 border-l-2 border-[var(--color-border)] ml-3 space-y-4">
                {group.items.map(item => {
                  const tc = categoryConfig[item.category];
                  return (
                    <div key={item.id} className="relative">
                      {/* Timeline dot */}
                      <div className={`absolute -left-[calc(2rem+3px)] w-3 h-3 rounded-full border-2 border-white mt-1.5 ${tc.dot}`} />

                      {/* Record card */}
                      <div className="bg-white rounded-xl border border-[var(--color-border)] p-4 hover:shadow-sm transition-shadow">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${tc.color}`}>
                                {tc.icon} {tc.label}
                              </span>
                              <span className="text-[10px] text-[var(--color-text-muted)]">{formatDate(item.timestamp)}</span>
                            </div>
                            <h4 className="text-sm font-medium text-[var(--color-text)] mb-1">{item.title}</h4>
                            {item.summary && <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2">{item.summary}</p>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
