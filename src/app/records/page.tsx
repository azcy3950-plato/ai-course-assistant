'use client';

import React, { useState, useMemo } from 'react';
import { useLearning } from '@/contexts/LearningContext';
import { RecordType, LearningRecord } from '@/types';

const typeConfig: Record<RecordType, { icon: string; label: string; color: string }> = {
  knowledge: { icon: '📚', label: '知识问答', color: 'bg-blue-100 text-blue-700' },
  guided: { icon: '💡', label: '引导学习', color: 'bg-green-100 text-green-700' },
  sandbox: { icon: '🗺️', label: '电子沙盘', color: 'bg-purple-100 text-purple-700' },
};

export default function RecordsPage() {
  const { state } = useLearning();
  const [filter, setFilter] = useState<RecordType | 'all'>('all');

  const filteredRecords = useMemo(() => {
    if (filter === 'all') return state.records;
    return state.records.filter(r => r.type === filter);
  }, [state.records, filter]);

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

  // Group records by date
  const groupedRecords = useMemo(() => {
    const groups: { date: string; records: LearningRecord[] }[] = [];
    const seenDates = new Set<string>();

    for (const record of filteredRecords) {
      const dateStr = new Date(record.timestamp).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      });
      if (!seenDates.has(dateStr)) {
        seenDates.add(dateStr);
        groups.push({ date: dateStr, records: [] });
      }
      const group = groups.find(g => g.date === dateStr) || groups[groups.length - 1];
      if (group) {
        group.records.push(record);
      }
    }

    return groups;
  }, [filteredRecords]);

  // Stats
  const stats = useMemo(() => {
    return {
      total: state.records.length,
      knowledge: state.records.filter(r => r.type === 'knowledge').length,
      guided: state.records.filter(r => r.type === 'guided').length,
      sandbox: state.records.filter(r => r.type === 'sandbox').length,
      totalMinutes: state.records.reduce((sum, r) => sum + (r.duration || 0), 0),
    };
  }, [state.records]);

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
          <div className="text-2xl font-bold text-purple-700">{stats.sandbox}</div>
          <div className="text-xs text-purple-600">沙盘实验</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {([
          { key: 'all' as const, label: '全部', icon: '📋' },
          { key: 'knowledge' as const, label: '知识问答', icon: '📚' },
          { key: 'guided' as const, label: '引导学习', icon: '💡' },
          { key: 'sandbox' as const, label: '电子沙盘', icon: '🗺️' },
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
      {groupedRecords.length === 0 ? (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-12 text-center">
          <div className="text-5xl mb-4">📭</div>
          <h3 className="text-lg font-bold text-[var(--color-text)] mb-2">暂无学习记录</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            开始使用知识问答、引导学习或电子沙盘后，记录将显示在这里
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupedRecords.map((group, gi) => (
            <div key={gi}>
              <div className="text-sm font-bold text-[var(--color-text)] mb-3 flex items-center gap-2">
                <span>📅</span>
                {group.date}
              </div>

              <div className="relative pl-8 border-l-2 border-[var(--color-border)] ml-3 space-y-4">
                {group.records.map(record => {
                  const tc = typeConfig[record.type];
                  return (
                    <div key={record.id} className="relative">
                      {/* Timeline dot */}
                      <div
                        className={`absolute -left-[calc(2rem+3px)] w-3 h-3 rounded-full border-2 border-white mt-1.5 ${
                          record.type === 'knowledge'
                            ? 'bg-blue-500'
                            : record.type === 'guided'
                            ? 'bg-green-500'
                            : 'bg-purple-500'
                        }`}
                      />

                      {/* Record card */}
                      <div className="bg-white rounded-xl border border-[var(--color-border)] p-4 hover:shadow-sm transition-shadow">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${tc.color}`}>
                                {tc.icon} {tc.label}
                              </span>
                            </div>
                            <h4 className="text-sm font-medium text-[var(--color-text)] mb-1">
                              {record.title}
                            </h4>
                            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                              {record.summary}
                            </p>
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)] whitespace-nowrap shrink-0">
                            {formatDate(record.timestamp)}
                            {record.duration && (
                              <div className="text-[10px] mt-1">
                                ⏱ {record.duration} 分钟
                              </div>
                            )}
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
