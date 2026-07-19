'use client';

import React from 'react';
import { LineChart, Line, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';

interface TimelinePoint {
  time: number;
  floodArea: number;
  maxDepth: number;
}

interface Props {
  timeLabels: string[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  timelineValues: TimelinePoint[];
  isPlaying: boolean;
  onPlayPause: () => void;
  disabled: boolean;
}

export default function Timeline({
  timeLabels,
  currentIndex,
  onIndexChange,
  timelineValues,
  isPlaying,
  onPlayPause,
  disabled,
}: Props) {
  const hasData = timelineValues.length > 0 && timelineValues.some(t => t.maxDepth > 0);
  const maxArea = hasData ? Math.max(...timelineValues.map(t => t.floodArea), 0.1) : 1;

  // Normalize for background area chart
  const areaData = timelineValues.map(t => ({
    time: t.time,
    area: t.floodArea,
  }));

  return (
    <div className="bg-white border-t border-[var(--color-border)] p-4">
      <div className="flex items-center gap-4 max-w-[1600px] mx-auto">
        {/* Play/Pause */}
        <button
          onClick={onPlayPause}
          disabled={disabled || !hasData}
          className="w-10 h-10 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center hover:bg-[var(--color-primary-dark)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
          title={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        {/* Time display */}
        <div className="text-sm font-mono font-bold text-[var(--color-text)] w-16 text-center shrink-0">
          {hasData ? `${timeLabels[currentIndex]}` : '—'}
        </div>

        {/* Mini area chart background */}
        <div className="flex-1 relative">
          {hasData && (
            <div className="absolute inset-0 opacity-20">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={areaData}>
                  <Line
                    type="monotone"
                    dataKey="area"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Slider */}
          <input
            type="range"
            min={0}
            max={Math.max(timeLabels.length - 1, 1)}
            step={1}
            value={currentIndex}
            onChange={e => onIndexChange(Number(e.target.value))}
            disabled={disabled || !hasData}
            className="w-full h-1.5 bg-transparent rounded-full appearance-none cursor-pointer relative z-10 disabled:cursor-not-allowed"
            style={{
              accentColor: 'var(--color-primary)',
            }}
          />
        </div>

        {/* End time */}
        <div className="text-sm font-mono text-[var(--color-text-muted)] w-16 text-center shrink-0">
          {hasData ? timeLabels[timeLabels.length - 1] : '—'}
        </div>

        {/* Step indicator */}
        <div className="text-xs text-[var(--color-text-muted)] w-16 text-center shrink-0">
          {hasData ? `${Math.round((currentIndex / (timeLabels.length - 1)) * 100)}%` : ''}
        </div>
      </div>
    </div>
  );
}
