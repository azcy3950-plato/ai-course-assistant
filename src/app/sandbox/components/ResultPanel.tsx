'use client';

import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface TimelinePoint {
  time: number;
  floodArea: number;
  maxDepth: number;
}

interface Props {
  stats: { floodArea: number; maxDepth: number; highRiskZones: number };
  timelineValues: TimelinePoint[];
  aiQuestion: string;
  onAiQuestionChange: (q: string) => void;
  onAskAI: () => void;
  aiResponse: string;
  aiLoading: boolean;
  swmmResult?: any;
}

export default function ResultPanel({
  stats,
  timelineValues,
  aiQuestion,
  onAiQuestionChange,
  onAskAI,
  aiResponse,
  aiLoading,
  swmmResult,
}: Props) {
  const hasSimulation = timelineValues.length > 0 && timelineValues.some(t => t.maxDepth > 0);

  // Format timeline data for the chart
  const chartData = timelineValues
    .filter((_, i) => i % Math.ceil(timelineValues.length / 20) === 0 || i === timelineValues.length - 1)
    .map(t => ({
      time: `${t.time}min`,
      '积水面积(km²)': t.floodArea,
      '最大深度(m)': +(t.maxDepth * 10).toFixed(1), // Scale for dual-axis
    }));

  return (
    <aside className="w-72 bg-white border-l border-[var(--color-border)] flex flex-col shrink-0 overflow-y-auto">
      <div className="p-4 border-b border-[var(--color-border)]">
        <h3 className="text-sm font-bold text-[var(--color-text)]">
          📈 模拟结果
        </h3>
      </div>

      <div className="flex-1 p-4 space-y-4">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-2">
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="text-[10px] text-blue-600 mb-0.5">积水面积</div>
            <div className="text-lg font-bold text-blue-900">
              {stats.floodArea > 0 ? `${stats.floodArea} km²` : '—'}
            </div>
          </div>
          <div className="bg-purple-50 rounded-lg p-3">
            <div className="text-[10px] text-purple-600 mb-0.5">最大深度</div>
            <div className="text-lg font-bold text-purple-900">
              {stats.maxDepth > 0 ? `${stats.maxDepth} m` : '—'}
            </div>
          </div>
          <div className="bg-red-50 rounded-lg p-3">
            <div className="text-[10px] text-red-600 mb-0.5">高风险区</div>
            <div className="text-lg font-bold text-red-900">
              {stats.highRiskZones > 0 ? `${stats.highRiskZones} 处` : '—'}
            </div>
          </div>
        </div>

        {/* Mini Chart */}
        {hasSimulation && (
          <div>
            <div className="text-[10px] font-medium text-[var(--color-text-muted)] mb-2">
              积水趋势
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="time" tick={{ fontSize: 8 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 8 }} stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="积水面积(km²)"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* AI Analysis */}
        {hasSimulation && (
          <div className="border-t border-[var(--color-border)] pt-4">
            <div className="text-[10px] font-medium text-[var(--color-text-muted)] mb-2">
              🤖 AI 分析
            </div>

            <div className="flex gap-1.5 mb-2">
              <input
                type="text"
                value={aiQuestion}
                onChange={e => onAiQuestionChange(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onAskAI()}
                placeholder="询问积水原因或改进建议..."
                className="flex-1 text-xs border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 outline-none focus:border-[var(--color-primary)]"
              />
              <button
                onClick={onAskAI}
                disabled={aiLoading || !aiQuestion.trim()}
                className="px-3 py-1.5 bg-[var(--color-primary)] text-white rounded-lg text-xs font-medium hover:bg-[var(--color-primary-dark)] disabled:opacity-40 transition-colors"
              >
                {aiLoading ? '...' : '分析'}
              </button>
            </div>

            {aiResponse && (
              <div className="bg-gray-50 rounded-lg p-3 text-xs leading-relaxed text-[var(--color-text)] message-content whitespace-pre-wrap">
                {aiResponse}
              </div>
            )}

            <div className="text-[10px] text-[var(--color-text-muted)] mt-2">
              试试问："为什么这片区域积水严重？"或"有哪些改进方案？"
            </div>
          </div>
        )}
      {swmmResult?.ok && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-1 mb-2">
            <span className="text-xs font-bold text-[var(--color-text-secondary)]">🌊 SWMM 专业模型</span>
            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">EPA</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="bg-blue-50 rounded-lg p-2 text-center">
              <div className="text-base font-bold text-blue-700">{swmmResult.summary?.maxDepth?.toFixed(2)}m</div>
              <div className="text-[10px] text-blue-600">最大水深</div>
            </div>
            <div className="bg-green-50 rounded-lg p-2 text-center">
              <div className="text-base font-bold text-green-700">{swmmResult.summary?.timesteps}</div>
              <div className="text-[10px] text-green-600">模拟步数</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-2 text-center">
              <div className="text-base font-bold text-amber-700">{swmmResult.params?.intensity || 0}mm/h</div>
              <div className="text-[10px] text-amber-600">降雨强度</div>
            </div>
          </div>
          <div className="text-[10px] text-[var(--color-text-secondary)]">
            {swmmResult.subcatchments && Object.entries(swmmResult.subcatchments).map(([k, v]: [string, any]) => {
              const labels: Record<string, string> = { S_res: "🏘️住宅", S_com: "🏢商业", S_park: "🌳公园", S_ind: "🏭工业" };
              return <span key={k} className="mr-2">{labels[k] || k} {(v as number).toFixed(1)}m³</span>;
            })}
          </div>
          <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
            节点水深: {swmmResult.nodes && Object.entries(swmmResult.nodes).map(([k, v]: [string, any]) => k + " " + v.maxD.toFixed(2) + "m").join(" · ")}
          </div>
        </div>
      )}
      </div>
    </aside>
  );
}
