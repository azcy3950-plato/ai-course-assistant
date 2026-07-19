'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useLearning } from '@/contexts/LearningContext';
import { SandboxMode, SandboxLayer, FloodGrid } from '@/types';
import ParamPanel from './components/ParamPanel';
import ResultPanel from './components/ResultPanel';
import Timeline from './components/Timeline';
import { floodLegend } from '@/data/sandbox-scenarios';
import { computeSimulation } from '@/data/sandbox-scenarios';
import { querySandboxAgent } from '@/services/agent';

// Dynamic import for MapView (Leaflet requires window)
const MapView = dynamic(() => import('./components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="h-full bg-gray-100 flex items-center justify-center">
      <span className="animate-spin text-2xl">⏳</span>
      <span className="ml-2 text-[var(--color-text-secondary)]">加载地图...</span>
    </div>
  ),
});

export default function SandboxPage() {
  const { addRecord } = useLearning();

  const [mode, setMode] = useState<SandboxMode>('dynamic');
  const [layers, setLayers] = useState<SandboxLayer[]>([
    { id: 'terrain', name: '地形高程', color: '#8B7355', visible: true },
    { id: 'pipes', name: '排水管网', color: '#2563eb', visible: true },
    { id: 'buildings', name: '建筑分布', color: '#94a3b8', visible: false },
    { id: 'roads', name: '道路网络', color: '#475569', visible: false },
  ]);

  const [intensity, setIntensity] = useState(50);
  const [duration, setDuration] = useState(60);
  const [returnPeriod, setReturnPeriod] = useState(10);

  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationData, setSimulationData] = useState<ReturnType<typeof computeSimulation> | null>(null);
  const [currentTimeIndex, setCurrentTimeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [aiQuestion, setAiQuestion] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Run simulation
  useEffect(() => {
    if (!isSimulating) return;

    const data = computeSimulation(intensity, duration, 5);
    setSimulationData(data);
    setCurrentTimeIndex(0);
    setIsPlaying(false);
    setIsSimulating(false);

    addRecord('sandbox', `内涝模拟: ${intensity}mm/h`, `模拟了${intensity}mm/h降雨强度历时${duration}min的内涝情景`);
  }, [isSimulating, intensity, duration, addRecord]);

  // Auto-play
  useEffect(() => {
    if (!isPlaying || !simulationData) return;
    const timer = setInterval(() => {
      setCurrentTimeIndex(prev => {
        if (prev >= simulationData.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 500);
    return () => clearInterval(timer);
  }, [isPlaying, simulationData]);

  const currentFrame = simulationData?.[currentTimeIndex];
  const currentGrids = currentFrame?.grids ?? [];
  const currentTimeline = simulationData?.map((d, i) => ({
    time: (i * 5),
    floodArea: d.grids.reduce((sum, g) => sum + 0.05, 0),
    maxDepth: Math.max(...d.grids.map(g => g.depth), 0),
  })) ?? [];

  const timelineValues = useMemo(() => {
    return currentTimeline.length > 0 ? currentTimeline : [{ time: 0, floodArea: 0, maxDepth: 0 }];
  }, [currentTimeline]);

  const currentStats = useMemo(() => {
    if (!currentFrame) return { floodArea: 0, maxDepth: 0, highRiskZones: 0 };
    const area = currentFrame.grids.length * 0.05;
    const maxD = currentFrame.grids.reduce((max, g) => Math.max(max, g.depth), 0);
    const highRisk = currentFrame.grids.filter(g => g.depth > 0.3).length;
    return { floodArea: Math.round(area * 100) / 100, maxDepth: Math.round(maxD * 100) / 100, highRiskZones: highRisk };
  }, [currentFrame]);

  const handleStartSimulation = useCallback(() => {
    setIsSimulating(true);
    setAiResponse('');
    setAiQuestion('');
  }, []);

  const handleAskAI = useCallback(async () => {
    if (!aiQuestion.trim() || !currentFrame) return;
    setAiLoading(true);
    try {
      const resp = await querySandboxAgent(aiQuestion, {
        intensity,
        duration,
        maxDepth: currentStats.maxDepth,
        floodArea: currentStats.floodArea,
      });
      setAiResponse(resp.answer);
    } catch {
      setAiResponse('AI 分析出错，请重试。');
    } finally {
      setAiLoading(false);
    }
  }, [aiQuestion, currentFrame, intensity, duration, currentStats]);

  const timeLabels = useMemo(() => {
    if (!simulationData) return ['0min'];
    return simulationData.map((_, i) => `${i * 5}min`);
  }, [simulationData]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Map + Side Panels */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Parameters */}
        <ParamPanel
          mode={mode}
          onModeChange={setMode}
          layers={layers}
          onLayersChange={setLayers}
          intensity={intensity}
          onIntensityChange={setIntensity}
          duration={duration}
          onDurationChange={setDuration}
          returnPeriod={returnPeriod}
          onReturnPeriodChange={setReturnPeriod}
          onSimulate={handleStartSimulation}
          simulating={isSimulating}
        />

        {/* Center: Map */}
        <div className="flex-1 relative min-w-0">
          <MapView
            floodGrids={currentGrids}
            visibleLayers={layers.filter(l => l.visible)}
            mode={mode}
          />

          {/* Flood Legend */}
          <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur rounded-lg border border-[var(--color-border)] p-3 shadow-lg">
            <div className="text-[10px] font-medium text-[var(--color-text)] mb-2">
              积水深度图例
            </div>
            <div className="space-y-1">
              {floodLegend.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <div
                    className="w-4 h-2.5 rounded"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-[var(--color-text-secondary)]">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Time display */}
          {currentTimeline.length > 0 && (
            <div className="absolute top-4 right-4 bg-white/90 backdrop-blur rounded-lg border border-[var(--color-border)] px-4 py-2 shadow-lg">
              <div className="text-xs text-[var(--color-text-muted)]">模拟时间</div>
              <div className="text-lg font-bold text-[var(--color-text)]">
                {currentTimeIndex * 5} min
              </div>
            </div>
          )}
        </div>

        {/* Right: Results */}
        <ResultPanel
          stats={currentStats}
          timelineValues={timelineValues}
          aiQuestion={aiQuestion}
          onAiQuestionChange={setAiQuestion}
          onAskAI={handleAskAI}
          aiResponse={aiResponse}
          aiLoading={aiLoading}
        />
      </div>

      {/* Bottom: Timeline */}
      <Timeline
        timeLabels={timeLabels}
        currentIndex={currentTimeIndex}
        onIndexChange={(i) => {
          setCurrentTimeIndex(i);
          setIsPlaying(false);
        }}
        timelineValues={timelineValues}
        isPlaying={isPlaying}
        onPlayPause={() => {
          if (currentTimeIndex >= timelineValues.length - 1) {
            setCurrentTimeIndex(0);
          }
          setIsPlaying(!isPlaying);
        }}
        disabled={!simulationData}
      />
    </div>
  );
}
