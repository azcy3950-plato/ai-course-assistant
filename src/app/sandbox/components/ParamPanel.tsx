'use client';

import React from 'react';
import { SandboxMode, SandboxLayer } from '@/types';

interface Props {
  mode: SandboxMode;
  onModeChange: (mode: SandboxMode) => void;
  layers: SandboxLayer[];
  onLayersChange: (layers: SandboxLayer[]) => void;
  intensity: number;
  onIntensityChange: (v: number) => void;
  duration: number;
  onDurationChange: (v: number) => void;
  returnPeriod: number;
  onReturnPeriodChange: (v: number) => void;
  onSimulate: () => void;
  simulating: boolean;
}

export default function ParamPanel({
  mode,
  onModeChange,
  layers,
  onLayersChange,
  intensity,
  onIntensityChange,
  duration,
  onDurationChange,
  returnPeriod,
  onReturnPeriodChange,
  onSimulate,
  simulating,
}: Props) {
  const toggleLayer = (id: string) => {
    onLayersChange(
      layers.map(l => (l.id === id ? { ...l, visible: !l.visible } : l))
    );
  };

  return (
    <aside className="w-72 bg-white border-r border-[var(--color-border)] flex flex-col shrink-0 overflow-y-auto">
      <div className="p-4 border-b border-[var(--color-border)]">
        <h3 className="text-sm font-bold text-[var(--color-text)]">
          ⚙️ 参数设置
        </h3>
      </div>

      <div className="flex-1 p-4 space-y-5">
        {/* Mode Toggle */}
        <div>
          <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-2 block">
            模式
          </label>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => onModeChange('static')}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'static'
                  ? 'bg-white text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)]'
              }`}
            >
              🖼 静态
            </button>
            <button
              onClick={() => onModeChange('dynamic')}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'dynamic'
                  ? 'bg-white text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)]'
              }`}
            >
              🌊 动态
            </button>
          </div>
        </div>

        {/* Layer Controls */}
        <div>
          <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-2 block">
            展示图层
          </label>
          <div className="space-y-1.5">
            {layers.map(layer => (
              <label
                key={layer.id}
                className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded p-1.5 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={() => toggleLayer(layer.id)}
                  className="w-3.5 h-3.5 accent-[var(--color-primary)]"
                />
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: layer.color }}
                />
                <span className="text-xs text-[var(--color-text)]">{layer.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Dynamic Parameters */}
        {mode === 'dynamic' && (
          <>
            <div className="border-t border-[var(--color-border)] pt-4">
              <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-3 block">
                🌧 降雨参数
              </label>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[var(--color-text-muted)]">降雨强度</span>
                    <span className="font-bold text-[var(--color-text)]">{intensity} mm/h</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={200}
                    step={5}
                    value={intensity}
                    onChange={e => onIntensityChange(Number(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[var(--color-primary)]"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--color-text-muted)]">
                    <span>10</span>
                    <span>200</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[var(--color-text-muted)]">降雨历时</span>
                    <span className="font-bold text-[var(--color-text)]">{duration} min</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={180}
                    step={5}
                    value={duration}
                    onChange={e => onDurationChange(Number(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[var(--color-primary)]"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--color-text-muted)]">
                    <span>10min</span>
                    <span>180min</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[var(--color-text-muted)]">重现期</span>
                    <span className="font-bold text-[var(--color-text)]">{returnPeriod} 年</span>
                  </div>
                  <select
                    value={returnPeriod}
                    onChange={e => onReturnPeriodChange(Number(e.target.value))}
                    className="w-full text-xs border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 bg-white"
                  >
                    <option value={1}>1 年一遇</option>
                    <option value={3}>3 年一遇</option>
                    <option value={5}>5 年一遇</option>
                    <option value={10}>10 年一遇</option>
                    <option value={20}>20 年一遇</option>
                    <option value={50}>50 年一遇</option>
                    <option value={100}>100 年一遇</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Simulate Button */}
            <button
              onClick={onSimulate}
              disabled={simulating}
              className="w-full py-2.5 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-primary-dark)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
            >
              {simulating ? (
                <>
                  <span className="animate-spin">⏳</span>
                  模拟计算中...
                </>
              ) : (
                <>
                  ▶ 开始模拟
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* Mode description */}
      <div className="p-4 border-t border-[var(--color-border)]">
        <div className="text-[10px] text-[var(--color-text-muted)] leading-relaxed bg-gray-50 rounded-lg p-3">
          {mode === 'static' ? (
            <>
              <strong>静态模式：</strong>展示城市地形、排水管网、建筑和道路等基础图层。通过勾选不同图层对比分析城市排水系统布局。
            </>
          ) : (
            <>
              <strong>动态模式：</strong>设定降雨参数后点击"开始模拟"，地图将展示积水深度分布。拖动底部时间轴查看积水变化过程。
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
