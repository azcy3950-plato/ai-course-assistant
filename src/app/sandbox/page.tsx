"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { getAuthToken } from "@/contexts/AppContext";
import { parseInp, type Node3D, type Pipe3D, type SC3D } from "@/lib/inp-parser";
import { computeRiskStats } from "@/lib/risk-stats";
import * as THREE from "three";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, MarkPointComponent, MarkLineComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer, MarkPointComponent, MarkLineComponent]);

// ═══════════════════════════════════════════════════════════
// VISUAL CONSTANTS — professional muted palette, no neon
// ═══════════════════════════════════════════════════════════
function scColor(imperv: number): string {
  if (imperv > 80) return "#b08070";
  if (imperv > 40) return "#a09580";
  return "#809870";
}
const PIPE_COLOR      = "#5f7a8a";
const PIPE_EMISSIVE   = "#0a1118";
const NODE_COLOR      = "#5a7282";
const OUTFALL_COLOR   = "#b87050";
const OUTFALL_EMI     = "#180800";
const GROUND_COLOR    = "#4a4a4a";
const HIGHLIGHT_EMI   = "#ffffcc";

function chineseLabel(key: string): string {
  const map: Record<string, string> = {
    id: "编号", type: "类型", invert: "井底高程", ground: "地表高程",
    maxDepth: "最大水深", initDepth: "初始水深",
    from: "起点", to: "终点", diam: "管径", length: "长度",
    roughness: "糙率", shape: "断面形式", inOffset: "起点偏移", outOffset: "终点偏移",
    area: "面积", imperv: "不透水率", outlet: "出口节点",
    width: "宽度", slope: "坡度", vertices: "边界顶点数", vertCount: "中间顶点数",
    depth: "当前水深", totalInflow: "总入流", pondedVolume: "地表积水体积", floodingLosses: "节点洪泛损失",
    flow: "当前流量", velocity: "当前流速", capacity: "容量利用率",
    depthFraction: "充满度", volume: "当前体积",
  };
  return map[key] || key;
}
function chineseType(t: string): string {
  return t === "outfall" ? "出水口" : t === "junction" ? "检查井" : t;
}
function formatVal(key: string, v: any): string {
  if (v == null || v === "") return "未配置";
  if (typeof v !== "number") return String(v);
  if (key === "area") return (v / 10000).toFixed(3) + " ha";
  if (key === "imperv") return v.toFixed(0) + " %";
  if (key === "slope") return (v * 100).toFixed(2) + " %";
  if (["invert","ground","maxDepth","initDepth","diam","length","inOffset","outOffset","width"].includes(key)) return v.toFixed(2) + " m";
  return v.toFixed(3);
}
function fmtTime(hoursDecimal: number): string {
  const totalMin = Math.round(hoursDecimal * 60);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════
// PIPE CROSS-SECTION PANEL — 管网横截面水量展示(方案1)
// ═══════════════════════════════════════════════════════════
// 降雨情景:真实设计暴雨重现期(3/5/10/20/50 年),数据取自 INP [TIMESERIES]
import { RAIN_SCENARIOS, tsToPoints, type RainfallScenario, type RainfallScenarioKey } from "./rainfall-scenarios";
// 选中情景 → 对象(按 key)
function scnOf(key?: string): RainfallScenario | undefined {
  return RAIN_SCENARIOS.find(s => s.key === key);
}

// 共享几何:推演/热力图每步不再 new Geometry(长推演不掉帧)
const SHARED = {
  waterCyl: new THREE.CylinderGeometry(0.18, 0.18, 1, 8),
  heatDisc: new THREE.CircleGeometry(0.42, 16),
  overflowRing: new THREE.TorusGeometry(0.28, 0.05, 8, 10),
  flowParticle: new THREE.SphereGeometry(0.14, 6, 6),
  flowParticleMat: new THREE.MeshBasicMaterial({ color: "#7fd4ff", transparent: true, opacity: 0.85 }),
  overflowDisc: new THREE.CircleGeometry(1, 20), // 单位圆,半径用 scale 缩放(积水圆盘共享几何)
};

function PipeCrossSection({ diam, depth, depthFraction, flow, flowDir, landcover, previewRatio = 1, animate = true, compact = false, size = "md", onCanvas }: {
  diam: number; depth: number; depthFraction: number; flow: number; flowDir: string; landcover: string; previewRatio?: number; animate?: boolean; compact?: boolean; size?: "md" | "lg"; onCanvas?: (c: HTMLCanvasElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ diam, depth, depthFraction, flow, flowDir, previewRatio, compact, size });
  latest.current = { diam, depth, depthFraction, flow, flowDir, previewRatio, compact, size };
  const displayFill = useRef(0); // 显示充满度(平滑过渡到目标值,方案切换/时间轴跳转时变化过程可见)
  const displayFlow = useRef(0); // 流量数字滚动动画
  const animRef = useRef<{ from: number; to: number; t0: number } | null>(null); // easeOutCubic 0.4s 缓动
  useEffect(() => { if (onCanvas) onCanvas(canvasRef.current); }, [onCanvas]); // 截图用

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = latest.current.compact ? 88 : latest.current.size === "lg" ? 340 : 180, h = latest.current.compact ? 74 : latest.current.size === "lg" ? 240 : 150;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) / 2 - 16;
    let raf = 0;
    const draw = (now: number) => {
      const L = latest.current;
      // 雨强预览:水位按 previewRatio 缩放(拖动滑条即见变化);动态模式用 easeOutCubic 0.4s 缓动过渡
      const targetFill = Math.min(1, Math.max(0, (L.depthFraction || 0) * L.previewRatio));
      if (animate) {
        if (!animRef.current || animRef.current.to !== targetFill) animRef.current = { from: displayFill.current, to: targetFill, t0: now };
        const t = Math.min(1, (now - animRef.current.t0) / 400);
        const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
        displayFill.current = animRef.current.from + (animRef.current.to - animRef.current.from) * e;
        if (t >= 1) animRef.current = null;
      } else { displayFill.current = targetFill; animRef.current = null; }
      const fillRatio = displayFill.current;
      const flow = L.flow;
      // 流量数字滚动动画(非 compact 或大图显示)
      displayFlow.current += (flow - displayFlow.current) * 0.15;
      if (Math.abs(flow - displayFlow.current) < 0.002) displayFlow.current = flow;
      const dispFlow = displayFlow.current;

      // 管壁
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#6b7f8f";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#3a4a58";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

      // 内部阴影
      ctx.fillStyle = "#0d1419";
      ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, Math.PI * 2); ctx.fill();

      // 水量(圆管截面:按充满度填充弓形区域),水面正弦微波动画
      if (fillRatio > 0.001) {
        const R = r - 4;
        const wave = animate ? Math.sin(now * 0.004) * Math.min(1.8, R * 0.05) : 0; // 水面轻晃
        const dist = R - 2 * R * fillRatio;
        const waterY = cy + dist + wave;
        const chordHalf = Math.sqrt(Math.max(0, R * R - dist * dist));
        const isFull = fillRatio > 0.985;
        if (isFull) {
          ctx.fillStyle = "rgba(51,136,204,0.85)";
          ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
        } else if (chordHalf > 0.01) {
          const halfAngle = Math.acos(Math.min(1, Math.max(-1, dist / R)));
          const startAngle = Math.PI / 2 + halfAngle; // 左下
          const endAngle = Math.PI / 2 - halfAngle;   // 右下
          ctx.fillStyle = "rgba(51,136,204,0.75)";
          ctx.beginPath();
          ctx.moveTo(cx - chordHalf, waterY);
          ctx.lineTo(cx + chordHalf, waterY);
          // 统一顺时针经底部(屏幕角度增大方向):dist≥0 时是底部小弧,dist<0 时是 240° 大弧
          ctx.arc(cx, cy, R, endAngle, startAngle, false);
          ctx.closePath();
          ctx.fill();
          // 水面高光(随波动微移)
          ctx.strokeStyle = "rgba(180,220,255,0.7)";
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(cx - chordHalf, waterY); ctx.lineTo(cx + chordHalf, waterY); ctx.stroke();
        } else {
          // 极浅水:画一小段水面
          ctx.fillStyle = "rgba(51,136,204,0.75)";
          ctx.fillRect(cx - 1.5, cy + R - 1, 3, 2);
        }
        // 满管警告:橙色脉冲(透明度随呼吸变化)
        if (fillRatio > 0.9) {
          const pulse = animate ? 0.55 + 0.45 * Math.sin(now * 0.006) : 0.9;
          ctx.strokeStyle = `rgba(255,120,60,${pulse.toFixed(2)})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI * 2); ctx.stroke();
        }
      }

      // 标注(compact 降字号防裁切);满管/高充满度时数字变红脉冲
      const danger = fillRatio > 0.9;
      const dangerColor = danger && animate ? `rgba(255,90,70,${(0.75 + 0.25 * Math.sin(now * 0.006)).toFixed(2)})` : "#f87171";
      ctx.fillStyle = "#9fb2c0";
      ctx.font = L.compact ? "8px monospace" : "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(L.compact ? `${(fillRatio * 100).toFixed(0)}%` : `d=${L.diam.toFixed(2)}m 充满度=${(fillRatio * 100).toFixed(0)}%`, cx, h - 5);
      ctx.fillStyle = danger ? dangerColor : "rgba(80,170,230,0.9)";
      ctx.fillText(L.compact ? `${flow >= 0 ? "→" : "←"}${Math.abs(dispFlow).toFixed(2)}` : `水深 ${Math.min(L.depth * L.previewRatio, L.diam).toFixed(2)}m · ${flow >= 0 ? "→" : "←"} ${Math.abs(dispFlow).toFixed(2)}m³/s`, cx, 9);
      if (animate) raf = requestAnimationFrame(draw); // 动态模式持续绘制;静态模式画完即停
    };
    if (animate) {
      raf = requestAnimationFrame(draw);
    } else {
      draw(0); // 静态模式(如三方案对比):一次性绘制,零 rAF 空转
    }
    return () => cancelAnimationFrame(raf);
  }, [animate, diam, depth, depthFraction, flow, previewRatio]);

  return (
    <div className={`rounded-lg border border-gray-700 bg-black/80 ${latest.current.compact ? "p-0.5" : "p-1.5"}`}>
      {!latest.current.compact && (
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-[10px] font-bold text-gray-300">🔵 管道横截面</span>
          <span className="text-[9px] text-gray-500">{landcover === "green" ? "🟢 绿色海绵" : landcover === "gray" ? "🟠 灰色强开发" : "⚪ 现状"}</span>
        </div>
      )}
      <canvas ref={canvasRef} className="block" />
      {!latest.current.compact && <div className="px-1 pt-1 text-[9px] leading-4 text-gray-500">{flowDir}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TIME-SERIES CHART PANEL
// ═══════════════════════════════════════════════════════════
function ChartPanel({ selected, dynRes, dynStep, timeStepCount, currentTimeLabel, onSeek }: {
  selected: any; dynRes: any; dynStep: number; timeStepCount: number; currentTimeLabel: string; onSeek?: (step: number) => void;
}) {
  const [chartOpen, setChartOpen] = useState(false);
  const timestamps: number[] = dynRes?.timestamps || [];

  function makeOption(title: string, data: number[], yLabel: string, color: string) {
    const markData = dynStep < data.length ? [{ xAxis: `${(timestamps[dynStep] ?? dynStep).toFixed(1)}h` }] : [];
    return {
      backgroundColor: 'transparent',
      grid: { top: 28, right: 12, bottom: 24, left: 48 },
      tooltip: { trigger: 'axis' as const },
      xAxis: { type: 'category' as const, data: timestamps.map((t: number) => t.toFixed(1) + 'h'), axisLabel: { color: '#888', fontSize: 9, interval: Math.max(0, Math.floor(timestamps.length / 6) - 1) } },
      yAxis: { type: 'value' as const, name: yLabel, nameTextStyle: { color: '#888', fontSize: 9 }, axisLabel: { color: '#888', fontSize: 9 } },
      series: [{
        name: title, type: 'line' as const, data, smooth: false, symbol: 'none',
        lineStyle: { color, width: 1.5 },
        markLine: dynStep < data.length ? { silent: true, symbol: 'none', lineStyle: { color: '#ffff00', width: 1, type: 'dashed' as const }, data: markData, label: { show: true, formatter: currentTimeLabel, color: '#ffff00', fontSize: 9 } } : undefined,
      }],
      legend: { show: false },
    };
  }

  const chartH = 140;
  // 曲线点击联动时间轴(传给所有图表);dataIndex 钳制防越界
  const seekEvents = { click: (p: any) => { if (p?.dataIndex != null && onSeek) onSeek(Math.min(Math.max(0, p.dataIndex), Math.max(0, timeStepCount - 1))); } };

  if (selected?.type === "node") {
    const nd = dynRes?.nodes?.[selected.data.id];
    if (!nd) return null;
    const d = nd.depth || []; const ti = nd.totalInflow || []; const pv = nd.pondedVolume || []; const fl = nd.floodingLosses || [];
    return (
      <div className="absolute left-2 right-2 bg-black/92 backdrop-blur rounded-lg border border-gray-700 z-10" style={{ bottom: 48 }}>
        <button onClick={() => setChartOpen(!chartOpen)} className="w-full px-3 py-1 text-left text-[10px] text-gray-400 hover:text-gray-200 flex justify-between">
          <span>📈 {selected.data.id} 时间序列</span><span>{chartOpen ? "收起 ▲" : "展开 ▼"}</span>
        </button>
        {chartOpen && (
          <div className="grid grid-cols-2 gap-1 px-1 pb-1">
            <ReactEChartsCore echarts={echarts} option={makeOption("水深 (m)", d, "m", "#4fc3f7")} style={{ height: chartH }} notMerge onEvents={seekEvents} />
            <ReactEChartsCore echarts={echarts} option={makeOption("总入流 (m³/s)", ti, "m³/s", "#81c784")} style={{ height: chartH }} notMerge onEvents={seekEvents} />
            <ReactEChartsCore echarts={echarts} option={makeOption("地表积水体积 (m³)", pv, "m³", "#ff8a65")} style={{ height: chartH }} notMerge onEvents={seekEvents} />
            <ReactEChartsCore echarts={echarts} option={makeOption("洪泛损失", fl, "", "#ef5350")} style={{ height: chartH }} notMerge onEvents={seekEvents} />
          </div>
        )}
      </div>
    );
  }

  if (selected?.type === "pipe") {
    const ld = dynRes?.links?.[selected.data.id];
    if (!ld) return null;
    const fl = ld.flow || []; const dp = ld.depth || []; const vl = ld.velocity || []; const cp = ld.capacity || [];
    return (
      <div className="absolute left-2 right-2 bg-black/92 backdrop-blur rounded-lg border border-gray-700 z-10" style={{ bottom: 48 }}>
        <button onClick={() => setChartOpen(!chartOpen)} className="w-full px-3 py-1 text-left text-[10px] text-gray-400 hover:text-gray-200 flex justify-between">
          <span>📈 {selected.data.id} 时间序列</span><span>{chartOpen ? "收起 ▲" : "展开 ▼"}</span>
        </button>
        {chartOpen && (
          <div className="grid grid-cols-2 gap-1 px-1 pb-1">
            <ReactEChartsCore echarts={echarts} option={makeOption("流量 (m³/s)", fl, "m³/s", "#4fc3f7")} style={{ height: chartH }} notMerge onEvents={seekEvents} />
            <ReactEChartsCore echarts={echarts} option={makeOption("水深 (m)", dp, "m", "#81c784")} style={{ height: chartH }} notMerge onEvents={seekEvents} />
            <ReactEChartsCore echarts={echarts} option={makeOption("流速 (m/s)", vl, "m/s", "#ff8a65")} style={{ height: chartH }} notMerge onEvents={seekEvents} />
            <ReactEChartsCore echarts={echarts} option={makeOption("容量利用率", cp, "", "#ba68c8")} style={{ height: chartH }} notMerge onEvents={seekEvents} />
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════
export default function SandboxPage() {
  const cr = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const dataRef = useRef<any>(null);
  const groupsRef = useRef<Record<string, THREE.Group>>({});
  const selRef = useRef<THREE.Object3D | null>(null);
  const camState = useRef({ theta: 0.45, phi: 0.85, dist: 500, tx: 0, tz: 0 });
  const orbitRef = useRef(false);
  const [orbit, setOrbit] = useState(false);
  useEffect(() => { orbitRef.current = orbit; }, [orbit]);
  const nodeGeomMap = useRef<Map<string, { group: THREE.Group; invertY: number; groundY: number }>>(new Map());
  const pipeMeshMap = useRef<Map<string, THREE.Mesh>>(new Map());
  const pipeEndsMap = useRef<Map<string, { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number }>>(new Map());
  const flowParticleMap = useRef<Map<string, THREE.Mesh>>(new Map());
  const waterMeshMap = useRef<Map<string, THREE.Mesh>>(new Map());
  const spanRef = useRef(300);
  const simSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"static" | "dynamic">("static");
  const [selected, setSelected] = useState<any>(null);
  // 3D 悬浮迷你横截面:选中管道时跟随管道中点(billboard),ref 直改 style 避免每帧 setState
  const [floatPipeId, setFloatPipeId] = useState<string | null>(null);
  const floatPipeIdRef = useRef<string | null>(null);
  const floatRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { const id = selected?.type === "pipe" ? selected.data.id : null; floatPipeIdRef.current = id; setFloatPipeId(id); }, [selected]);
  // 横截面放大模态 + 截图(当前选中管道)
  const [zoomPipeId, setZoomPipeId] = useState<string | null>(null);
  const [snapCanvas, setSnapCanvas] = useState<HTMLCanvasElement | null>(null);
  // 横截面大图模式:大画布 + 滚轮缩放(1-3x)+ 拖动平移
  const [bigView, setBigView] = useState(false);
  const [bigZoom, setBigZoom] = useState(1);
  const [bigPos, setBigPos] = useState({ x: 0, y: 0 });
  const bigDragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  // 更多管道对比:数量 2-6(默认 3)+ 自选管道列表(空=自动 TopN)
  const [pipeCount, setPipeCount] = useState(3);
  const [customPipes, setCustomPipes] = useState<string[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  // 3D 联动:推演中 TopN 自动轮流高亮(3s/根),大图跟随;横截面 hover 同步 3D 高亮
  const [autoFocusIdx, setAutoFocusIdx] = useState(0);
  const hoverPipe3DRef = useRef<THREE.Mesh | null>(null);
  const highlightPipe3D = (id: string | null) => {
    if (hoverPipe3DRef.current) {
      const m = hoverPipe3DRef.current; const mat = m.material as any;
      if (mat?.userData?.xsecHoverOrig != null) mat.emissiveIntensity = mat.userData.xsecHoverOrig;
    }
    hoverPipe3DRef.current = null;
    if (!id) return;
    const m = pipeMeshMap.current.get(id);
    if (m) { const mat = m.material as any; if (mat?.userData && mat.userData.xsecHoverOrig === undefined) mat.userData = { ...(mat.userData || {}), xsecHoverOrig: mat.emissiveIntensity }; if (mat) mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 0.8); hoverPipe3DRef.current = m; }
  };
  const downloadSnap = () => {
    if (!snapCanvas) return;
    const a = document.createElement("a");
    a.href = snapCanvas.toDataURL("image/png");
    a.download = `sandbox-${zoomPipeId || "pipe"}.png`;
    a.click();
  };
  // 3D 变化百分比标签(切方案/调雨强后 Top5 管道上方悬浮 ▼/▲%,5s 消失)
  const [deltaLabels, setDeltaLabels] = useState<Array<{ id: string; text: string; color: string }>>([]);
  const deltaLabelsRef = useRef<Array<{ id: string; el: HTMLDivElement | null }>>([]);
  const [layers, setLayers] = useState<Record<string, boolean>>({ sc: true, pipes: true, nodes: true, ground: true });
  const [stats, setStats] = useState({ nodes: 0, pipes: 0, scs: 0 });
  const [vertEx, setVertEx] = useState(5);

  // Dynamic state
  const [scn, setScn] = useState<RainfallScenarioKey>("5A");
  const draggedRainRef = useRef(false); // 用户是否曾拖动过雨强滑条(引导第 3 步完成条件)
  // 管道调节阀:已生效开度(pipeId→0-1)与拖动中预览;防抖重跑(与雨强滑条同模式)
  const [valves, setValves] = useState<Record<string, number>>({});
  const [valveDraft, setValveDraft] = useState<Record<string, number>>({});
  const valveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valvesRef = useRef<Record<string, number>>({});
  useEffect(() => { valvesRef.current = valves; }, [valves]);
  // 下垫面渐变 state(声明须在着色 effect 之前):绿色强度 0-1,仅 landcover=green 生效
  const [greenLevel, setGreenLevel] = useState(1);
  const greenLevelRef = useRef(1);
  const greenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { greenLevelRef.current = greenLevel; }, [greenLevel]);
  const [landcover, setLandcover] = useState<"default" | "gray" | "green">("default");
  // 雨强预览:拖动滑条时即时缩放横截面水位,松手防抖后真实仿真覆盖
  const [rainPreview, setRainPreview] = useState<number | null>(null);
  const simIBaseRef = useRef(100); // 当前已仿真结果对应的强度
  const rainTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 切方案变化高亮与提示:上一次仿真结果(不同方案/强度)用于计算 Δ
  const prevSimRef = useRef<any>(null);
  const [schemeMsg, setSchemeMsg] = useState<{ text: string; color: string } | null>(null);
  const schemeMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Δ 高亮由着色 effect 统一应用(避免被 effect 重着色覆盖),until 后自然过期
  const highlightRef = useRef<{ top: Array<[string, number]>; until: number } | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 水流溯源:选中管道时上下游路径高亮(上游蓝/下游青),5s 或取消选中恢复
  const traceRef = useRef<{ up: string[]; down: string[] } | null>(null);
  const traceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 首次进入动态模式引导气泡(一次性,localStorage 记忆)
  const [showTip, setShowTip] = useState(false);
  // 分步新手引导:1 点击管道 → 2 切换方案 → 3 拖动雨强滑条(每步完成自动下一步,可跳过)
  const [guide, setGuide] = useState(0);
  // 悬停提示:内容变化才 setState(位置由原生事件直接改 style,避免高频重渲染)
  const [hoverInfo, setHoverInfo] = useState<{ lines: string[]; type: string } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [dynRes, setDynRes] = useState<any>(null);
  const [dynStep, setDynStep] = useState(0);
  const [dynPlay, setDynPlay] = useState(false);
  const [dynSpd, setDynSpd] = useState(1);
  const [dynPhase, setDynPhase] = useState<"config"|"loading"|"ready"|"running"|"paused"|"done">("config");
  const [simId, setSimId] = useState("");
  const [heatmap, setHeatmap] = useState(false);
  // 渲染模式:默认/水深/流量/风险(覆盖原独立热力图按钮);渲染 Popover 选择
  const [renderMode, setRenderMode] = useState<"default" | "depth" | "flow" | "risk">("default");
  const [openBar, setOpenBar] = useState<"render" | "view" | "layer" | null>(null);
  const [curView, setCurView] = useState<"panorama" | "topdown" | "underground">("panorama");
  const [theme, setTheme] = useState<"dark" | "light">(() => { try { return localStorage.getItem("sandbox-theme") === "light" ? "light" : "dark"; } catch { return "dark"; } });
  // 场景主题联动:深色 ↔ 浅色(背景/雾/网格)
  const applyTheme = useCallback(() => {
    const sc = sceneRef.current; if (!sc) return;
    const isLight = themeRef.current === "light";
    (sc.background as THREE.Color)?.set(isLight ? "#e8eef6" : "#1c1c24");
    (sc.fog as THREE.Fog)?.color?.set(isLight ? "#e8eef6" : "#1c1c24");
    const gm = gridRef.current?.material as THREE.LineBasicMaterial | undefined;
    if (gm) gm.color.set(isLight ? "#9db4cc" : "#5a5a5a");
  }, []);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  useEffect(() => { applyTheme(); try { localStorage.setItem("sandbox-theme", theme); } catch { /* 忽略 */ } }, [theme, applyTheme]);

  const timeStepCount = dynRes?.timeStepCount || 0;
  const timestamps: number[] = dynRes?.timestamps || [];
  const currentTimeLabel = timestamps[dynStep] !== undefined ? fmtTime(timestamps[dynStep]) : "--:--";

  // ═══════════════════════════════════════════════════════════
  // SCENE INITIALIZATION
  // ═══════════════════════════════════════════════════════════
  useEffect(() => { (async () => {
    try {
      const r = await fetch("/zijing_inp.inp");
      if (!r.ok) throw new Error("INP 加载失败: " + r.status);
      const data = parseInp(await r.text());
      dataRef.current = data;
      setStats({ nodes: data.nodes.length, pipes: data.pipes.length, scs: data.scs.length });
      if (!cr.current) return;

      const w = cr.current.clientWidth, h = cr.current.clientHeight;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#1c1c24");
      scene.fog = new THREE.Fog("#1c1c24", 300, 1200);
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(48, w / h, 0.3, 2500);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      cr.current.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      scene.add(new THREE.AmbientLight("#667788", 0.8));
      const sun = new THREE.DirectionalLight("#fff8e8", 2.2);
      sun.position.set(200, 350, 80);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.near = 1; sun.shadow.camera.far = 1500;
      sun.shadow.camera.left = -250; sun.shadow.camera.right = 250;
      sun.shadow.camera.top = 250; sun.shadow.camera.bottom = -250;
      scene.add(sun);
      scene.add(new THREE.HemisphereLight("#8899bb", "#334455", 0.4));

      buildGeometry(scene, data, 5);

      let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
      data.nodes.forEach((n: Node3D) => { if (n.x < mnX) mnX = n.x; if (n.x > mxX) mxX = n.x; if (n.z < mnZ) mnZ = n.z; if (n.z > mxZ) mxZ = n.z; });
      const cx = (mnX + mxX) / 2, cz = (mnZ + mxZ) / 2;
      const span = Math.max(mxX - mnX, mxZ - mnZ, 50);
      spanRef.current = span;
      camState.current = { theta: 0.45, phi: 0.85, dist: span * 1.35, tx: cx, tz: cz };

      const updateCam = () => {
        const cs = camState.current;
        camera.position.x = cs.tx + cs.dist * Math.sin(cs.phi) * Math.cos(cs.theta);
        camera.position.y = cs.dist * Math.cos(cs.phi) * 0.65;
        camera.position.z = cs.tz + cs.dist * Math.sin(cs.phi) * Math.sin(cs.theta);
        camera.lookAt(cs.tx, cs.dist * 0.04, cs.tz);
      };
      updateCam();
      setLoaded(true);

      // Mouse controls
      let dragging = false, last = { x: 0, y: 0 };
      renderer.domElement.addEventListener("mousedown", e => { if (e.button <= 1) { dragging = true; last = { x: e.clientX, y: e.clientY }; } });
      renderer.domElement.addEventListener("mousemove", e => { if (!dragging) return; camState.current.theta -= (e.clientX - last.x) * 0.005; camState.current.phi = Math.max(0.15, Math.min(1.5, camState.current.phi - (e.clientY - last.y) * 0.005)); last = { x: e.clientX, y: e.clientY }; updateCam(); });
      window.addEventListener("mouseup", () => { dragging = false; });
      renderer.domElement.addEventListener("wheel", e => { e.preventDefault(); camState.current.dist = Math.max(span * 0.25, Math.min(span * 4, camState.current.dist + e.deltaY * 0.5)); updateCam(); });

      const raycaster = new THREE.Raycaster();
      // 点击聚焦:0.6s 平滑飞行到选中对象(easeOutCubic)
      let focusAnim: { t0: number; from: { theta: number; phi: number; dist: number; tx: number; tz: number }; to: { theta: number; phi: number; dist: number; tx: number; tz: number } } | null = null;
      const flyTo = (x: number, z: number) => {
        const cs = camState.current;
        focusAnim = { t0: performance.now(), from: { ...cs }, to: { ...cs, tx: x, tz: z, dist: Math.max(span * 0.4, cs.dist * 0.55) } };
      };
      // 对象聚焦中心:管道/汇水区 mesh.position 恒为原点(几何为绝对坐标),须用包围盒中心
      const flyToObj = (obj: any) => {
        try {
          const box = new THREE.Box3().setFromObject(obj);
          flyTo((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2);
        } catch { flyTo(obj.position.x, obj.position.z); }
      };
      // 拾取:过滤水柱/粒子等装饰对象,返回带 type 的可交互对象
      const pick = (nx: number, ny: number): any => {
        raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
        const hits = raycaster.intersectObjects(scene.children, true);
        for (const h of hits) {
          let o: any = h.object;
          while (o) {
            if (o.userData?.type || o.userData?.storage) return o;
            if (o.userData?.particle || o.userData?.water) break;
            o = o.parent;
          }
        }
        return null;
      };
      // 地面拾取:放置/移动蓄水池时求地面交点坐标
      const groundPoint = (nx: number, ny: number): { x: number; z: number } | null => {
        raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
        const hits = raycaster.intersectObjects(scene.children, true);
        for (const h of hits) {
          let o: any = h.object;
          while (o) { if (o.userData?.type === "ground") return { x: h.point.x, z: h.point.z }; o = o.parent; }
        }
        return null;
      };
      let clickStart = { x: 0, y: 0 };
      renderer.domElement.addEventListener("click", e => {
        // 拖拽(旋转/平移)后松开不触发点击:位移阈值 5px
        const moved = Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y);
        if (moved > 5) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1, ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const obj = pick(nx, ny);
        if (obj) {
          if (selRef.current !== obj) { if (selRef.current) resetHL(selRef.current); selRef.current = obj; hlObj(obj); setSelected({ type: obj.userData.type, data: obj.userData.data }); }
          flyToObj(obj);
        } else if (selRef.current) { resetHL(selRef.current); selRef.current = null; setSelected(null); }
      });

      // 悬停提示:目标轻高亮 + tooltip(内容变化才 setState;位置原生直改;raycast 节流)
      let hoverObj: any = null;
      let lastHoverRay = 0;
      const hoverLines = (obj: any): string[] => {
        const ud = obj.userData || {};
        const id = ud.data?.id ?? "";
        if (ud.type === "pipe") {
          const d = ud.data || {};
          const lines = [`▬ 管道 ${id}`, `管径 ${(d.diam || 0).toFixed(2)}m · 长 ${(d.length || 0).toFixed(0)}m`, `${d.from ?? "?"} → ${d.to ?? "?"}`];
          const ld = (dynResRef.current as any)?.links?.[id];
          if (ld) {
            const i = kbState.current?.dynStep ?? 0;
            const f = ld.flow?.[i] ?? 0, df = ld.depthFraction?.[i] ?? 0;
            lines.push(`流量 ${f.toFixed(2)}m³/s · 充满度 ${(df * 100).toFixed(0)}%`);
          }
          return lines;
        }
        if (ud.type === "node") {
          const d = ud.data || {};
          const lines = [`● 节点 ${id}`, `${d.type === "outfall" ? "排放口" : d.type === "storage" ? "调蓄池" : "检查井"} · 井底 ${d.invert?.toFixed(2)}m`];
          const nd = (dynResRef.current as any)?.nodes?.[id];
          if (nd) {
            const i = kbState.current?.dynStep ?? 0;
            const dep = nd.depth?.[i] ?? 0;
            lines.push(`水深 ${dep.toFixed(2)}m${dep > 0.01 ? " · 有积水" : ""}`);
          }
          return lines;
        }
        if (ud.type === "sc") return [`▰ 汇水区 ${id}`, `不透水率 ${((ud.data?.imperv ?? 0) * 100).toFixed(0)}%`];
        return [String(id || ud.type)];
      };
      renderer.domElement.addEventListener("mousemove", e => {
        if (tooltipRef.current) { tooltipRef.current.style.left = (e.clientX + 14) + "px"; tooltipRef.current.style.top = (e.clientY + 12) + "px"; }
        if (dragging) { if (hoverObj) { if (hoverObj !== selRef.current && hoverObj.material) { const hm = hoverObj.material as any; if (hm.userData?.hoverEmissive != null && hm.emissiveIntensity === hm.userData.hoverSet) hm.emissiveIntensity = hm.userData.hoverEmissive; } hoverObj = null; setHoverInfo(null); } return; }
        // raycast 节流 50ms(位置更新保持实时,拾取不拖慢渲染)
        const nowT = performance.now();
        if (nowT - lastHoverRay < 50) return;
        lastHoverRay = nowT;
        const rect = renderer.domElement.getBoundingClientRect();
        const obj = pick(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        if (obj !== hoverObj) {
          // 离开旧对象:恢复其原 emissiveIntensity(若未恢复)
          if (hoverObj && hoverObj !== selRef.current && hoverObj.material) {
            const hm = hoverObj.material as any;
            if (hm.userData?.hoverEmissive != null && hm.emissiveIntensity === hm.userData.hoverSet) hm.emissiveIntensity = hm.userData.hoverEmissive;
          }
          if (obj) {
            const m = obj as THREE.Mesh;
            if (m.material && !(m.material as any)._isWater && obj !== selRef.current) {
              const mat = m.material as any;
              if (mat.userData?.hoverEmissive === undefined) {
                const orig = mat.emissiveIntensity;
                mat.userData = { ...(mat.userData || {}), hoverEmissive: orig, hoverSet: Math.max(orig, 0.28) };
              }
              mat.emissiveIntensity = mat.userData.hoverSet;
            }
          }
          hoverObj = obj;
          setHoverInfo(obj ? { lines: hoverLines(obj), type: obj.userData.type } : null);
        }
      });
      renderer.domElement.addEventListener("mouseleave", () => {
        if (hoverObj && hoverObj !== selRef.current && hoverObj.material) {
          const hm = hoverObj.material as any;
          if (hm.userData?.hoverEmissive != null && hm.emissiveIntensity === hm.userData.hoverSet) hm.emissiveIntensity = hm.userData.hoverEmissive;
        }
        hoverObj = null; setHoverInfo(null);
      });
      // 拖拽/环绕/聚焦时取消悬停与聚焦动画
      renderer.domElement.addEventListener("mousedown", e => { if (e.button <= 1) { dragging = true; last = { x: e.clientX, y: e.clientY }; clickStart = { x: e.clientX, y: e.clientY }; focusAnim = null; } });

      let rafId = 0;
      const animate = () => {
        rafId = requestAnimationFrame(animate);
        // 点击聚焦:0.6s easeOutCubic 插值相机位置/距离
        if (focusAnim) {
          const p = Math.min(1, (performance.now() - focusAnim.t0) / 600);
          const e = 1 - Math.pow(1 - p, 3);
          const f = focusAnim.from, t = focusAnim.to;
          camState.current.tx = f.tx + (t.tx - f.tx) * e;
          camState.current.tz = f.tz + (t.tz - f.tz) * e;
          camState.current.dist = f.dist + (t.dist - f.dist) * e;
          if (p >= 1) focusAnim = null;
          updateCam();
        }
        // 环绕模式:相机绕场景中心缓慢自动旋转
        if (orbitRef.current) { camState.current.theta += 0.0022; updateCam(); }
        // 默认横截面管道呼吸高亮(未选中时,蓝色光圈)
        const ap = autoPipeRef.current;
        if (ap && selRef.current?.userData?.type !== "pipe") {
          const m = pipeMeshMap.current.get(ap);
          if (m) {
            const mat = m.material as THREE.MeshStandardMaterial;
            const pulse = 0.28 + 0.22 * Math.sin(performance.now() * 0.004);
            mat.emissive.set("#1a3f8f");
            mat.emissiveIntensity = pulse;
          }
        }
        // 水流粒子:动态模式沿管道流动(方向=流向,速度∝流速);静态模式慢速示意默认流向
        const km = kbState.current;
        const pt = performance.now() / 1000;
        flowParticleMap.current.forEach((pm, pid) => {
          const ends = pipeEndsMap.current.get(pid);
          if (!ends) { pm.visible = false; return; }
          const ld = (km.dynRes as any)?.links?.[pid];
          const f = ld?.flow?.[km.dynStep] ?? 0;
          let speed: number, dir: number, show: boolean;
          if (km.mode === "dynamic") {
            show = Math.abs(f) > 0.0005;
            speed = Math.min(1.1, 0.06 + Math.abs(f) * 0.05);
            dir = f >= 0 ? 1 : -1;
            SHARED.flowParticleMat.opacity = 0.9;
          } else {
            show = true;
            speed = 0.07;
            dir = 1; // 静态模式:from → to 示意默认流向
            SHARED.flowParticleMat.opacity = 0.35;
          }
          pm.visible = show;
          if (!show) return;
          let prog = (dir * pt * speed) % 1;
          if (prog < 0) prog += 1;
          pm.position.set(ends.fx + (ends.tx - ends.fx) * prog, ends.fy + (ends.ty - ends.fy) * prog, ends.fz + (ends.tz - ends.fz) * prog);
        });
        // 水柱平滑过渡(切方案/雨强预览:指数趋近目标,~0.5s 到位)
        waterMeshMap.current.forEach((wm) => {
          const ud = (wm as any).userData;
          if (ud.targetScaleY == null) return;
          wm.scale.y += (ud.targetScaleY - wm.scale.y) * 0.08;
          wm.position.y += (ud.targetY - wm.position.y) * 0.08;
        });
        // 3D 变化百分比标签:Top5 管道上方投影跟随
        for (const dl of deltaLabelsRef.current) {
          const el = dl.el;
          if (!el) continue;
          const ends = pipeEndsMap.current.get(dl.id);
          if (!ends) { el.style.display = "none"; continue; }
          const mid = new THREE.Vector3((ends.fx + ends.tx) / 2, (ends.fy + ends.ty) / 2 + 0.4, (ends.fz + ends.tz) / 2);
          mid.project(camera);
          const rect = cr.current?.getBoundingClientRect();
          if (rect && mid.z < 1) {
            el.style.left = ((mid.x * 0.5 + 0.5) * rect.width) + "px";
            el.style.top = ((-mid.y * 0.5 + 0.5) * rect.height) + "px";
            el.style.display = "block";
          } else el.style.display = "none";
        }
        // 溢流红环闪烁(积水圆盘为 MeshBasicMaterial 无 emissive,自动跳过)
        const flick = 0.35 + 0.45 * Math.sin(performance.now() * 0.008);
        scene.traverse(o => { const m = o as any; if (m?.userData?.overflowRing && m.isMesh && m.material?.emissiveIntensity != null) m.material.emissiveIntensity = flick; });
        // 3D 悬浮迷你横截面:管道中点投影到屏幕坐标,div 跟随(billboard 效果)
        if (floatPipeIdRef.current && floatRef.current) {
          const ends = pipeEndsMap.current.get(floatPipeIdRef.current);
          if (ends) {
            const mid = new THREE.Vector3((ends.fx + ends.tx) / 2, (ends.fy + ends.ty) / 2, (ends.fz + ends.tz) / 2);
            mid.project(camera);
            const rect = cr.current?.getBoundingClientRect();
            if (rect && mid.z < 1) {
              const sx = (mid.x * 0.5 + 0.5) * rect.width, sy = (-mid.y * 0.5 + 0.5) * rect.height;
              const el = floatRef.current;
              el.style.left = sx + "px"; el.style.top = sy + "px";
              el.style.display = "block";
            } else if (floatRef.current) floatRef.current.style.display = "none";
          } else if (floatRef.current) floatRef.current.style.display = "none";
        } else if (floatRef.current) floatRef.current.style.display = "none";
        renderer.render(scene, camera);
      };
      animate();
      const onResize = () => { const w2 = cr.current!.clientWidth, h2 = cr.current!.clientHeight; camera.aspect = w2 / h2; camera.updateProjectionMatrix(); renderer.setSize(w2, h2); };
      window.addEventListener("resize", onResize);
      return () => { window.removeEventListener("resize", onResize); cancelAnimationFrame(rafId); renderer.dispose(); };
    } catch (e: any) { setError(e.message); }
  })(); }, []);

  function hlObj(obj: THREE.Object3D) {
    obj.traverse(c => { if (c instanceof THREE.Mesh && c.material && !(c.material as any)._isWater) { (c.material as any).emissive = new THREE.Color(HIGHLIGHT_EMI); (c.material as any).emissiveIntensity = 0.5; } });
  }
  function resetHL(obj: THREE.Object3D) {
    obj.traverse(c => { if (c instanceof THREE.Mesh && c.material && !(c.material as any)._isWater) { (c.material as any).emissive = new THREE.Color("#000000"); (c.material as any).emissiveIntensity = 0; } });
  }

  // KPI 点击定位:选中对象 + 跳转到对应时刻 + 相机聚焦 + (管道)打开横断面
  // 通过直改 camState/cameraRef 复用 effect 中同款相机公式,不重复造相机矩阵
  const jumpToObject = useCallback((id: string | undefined, type: "node" | "pipe") => {
    let cx = 0, cz = 0, hit = false;
    if (type === "pipe") {
      const ends = pipeEndsMap.current.get(id ?? "");
      if (ends) { cx = (ends.fx + ends.tx) / 2; cz = (ends.fz + ends.tz) / 2; hit = true; }
      const mesh = pipeMeshMap.current.get(id ?? "");
      if (mesh) { if (selRef.current && selRef.current !== mesh) resetHL(selRef.current); selRef.current = mesh; hlObj(mesh); setSelected({ type: "pipe", data: { ...(mesh.userData?.data || {}), id } }); }
    } else {
      const ng = nodeGeomMap.current.get(id ?? "");
      if (ng) { cx = ng.group.position.x; cz = ng.group.position.z; hit = true; }
      const nodes = dataRef.current?.nodes as any[] | undefined;
      const nd = nodes?.find((n: any) => n.id === id);
      if (nd) setSelected({ type: "node", data: nd });
    }
    if (hit) {
      const cs = camState.current;
      const dist = Math.max((spanRef.current || 300) * 0.35, cs.dist * 0.6);
      camState.current = { ...cs, tx: cx, tz: cz, dist };
      const cam = cameraRef.current; if (cam) {
        cam.position.x = cx + dist * Math.sin(cs.phi) * Math.cos(cs.theta);
        cam.position.y = dist * Math.cos(cs.phi) * 0.65;
        cam.position.z = cz + dist * Math.sin(cs.phi) * Math.sin(cs.theta);
        cam.lookAt(cx, dist * 0.04, cz);
      }
    }
  }, []);

  // 降雨过程曲线 option(真实时序):带 mm·h⁻¹ 纵轴 / 时间横轴 / 峰值点 / hover / 当前时刻线
  const rainChartOption = useCallback((s: RainfallScenario, dynMode: boolean) => {
    const ts = s.ts;
    const xData = ts.map((_, i) => {
      const hh = Math.floor((i * 5) / 60) % 24, mm = (i * 5) % 60;
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    });
    const series: any[] = [{
      name: "降雨强度", type: "line", data: ts, smooth: false, symbol: "none", lineStyle: { color: "#38bdf8", width: 1.6 },
      areaStyle: { color: "#1e4d7a", opacity: 0.25 },
      markPoint: { symbol: "pin", symbolSize: 26, data: [{ name: "峰值", coord: [xData.indexOf(s.peakTime), s.peakIntensity], value: s.peakIntensity + " mm/h", label: { color: "#fff", fontSize: 9 } }], itemStyle: { color: "#fb7185" } },
    }];
    if (dynMode) {
      const idx = Math.min(Math.max(0, dynStep), Math.max(0, timeStepCount - 1));
      series.push({ type: "line", markLine: { silent: true, symbol: "none", lineStyle: { color: "#fde047", width: 1, type: "dashed" }, data: [{ xAxis: xData[Math.min(idx, xData.length - 1)] }], label: { show: true, formatter: () => currentTimeLabel, position: "insideEndTop", color: "#fde047", fontSize: 8 } }, data: [] });
    }
    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 38, right: 8, top: 22, bottom: 22 },
      tooltip: { trigger: "axis", valueFormatter: (v: any) => `${v} mm/h`, axisPointer: { type: "line" } },
      xAxis: { type: "category", data: xData, boundaryGap: false, axisLabel: { color: "#94a3b8", fontSize: 8, interval: 47 }, axisLine: { lineStyle: { color: "#334155" } } },
      yAxis: { type: "value", name: "mm/h", nameTextStyle: { color: "#94a3b8", fontSize: 8 }, axisLabel: { color: "#94a3b8", fontSize: 8 }, splitLine: { lineStyle: { color: "#1f2937" } } },
      series,
    };
  }, [dynStep, timeStepCount, currentTimeLabel]);

  // ═══════════════════════════════════════════════════════════
  // BUILD GEOMETRY — professional engineering visual style
  // ═══════════════════════════════════════════════════════════
  function buildGeometry(scene: THREE.Scene, data: any, ve: number) {
    ["ground","sc","pipes","nodes"].forEach(k => { const old = groupsRef.current[k]; if (old) scene.remove(old); });
    const grp: Record<string, THREE.Group> = { ground: new THREE.Group(), sc: new THREE.Group(), pipes: new THREE.Group(), nodes: new THREE.Group() };
    Object.values(grp).forEach(g => scene.add(g));
    groupsRef.current = grp;
    nodeGeomMap.current.clear(); pipeMeshMap.current.clear(); waterMeshMap.current.clear();
    pipeEndsMap.current.clear(); flowParticleMap.current.clear();

    // Extents
    let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    let minElev = Infinity, maxElev = -Infinity;
    data.nodes.forEach((n: Node3D) => { if (n.x<mnX) mnX=n.x; if (n.x>mxX) mxX=n.x; if (n.z<mnZ) mnZ=n.z; if (n.z>mxZ) mxZ=n.z; if (n.invert<minElev) minElev=n.invert; if (n.ground>maxElev) maxElev=n.ground; });

    const span = Math.max(mxX - mnX, mxZ - mnZ, 50);
    const elevY = (e: number) => (e - minElev) * ve;
    // Ground plane at engineering surface (average of all node ground elevations)
    const avgSurface = data.nodes.reduce((s: number, n: Node3D) => s + n.ground, 0) / data.nodes.length;
    const gndY = elevY(avgSurface);

    // ── Scale parameters (all from span, NOT hardcoded) ──
    const NODE_R    = Math.max(0.2, span * 0.001);
    const OUTFALL_R = NODE_R * 1.5;
    const PIPE_MIN_R = Math.max(0.08, span * 0.0006);
    const PIPE_MAX_R = span * 0.0032;

    // ── Ground (dark gray, just slightly larger than model) ──
    const gndSpan = span * 1.12;
    const groundGeom = new THREE.PlaneGeometry(gndSpan, gndSpan);
    groundGeom.rotateX(-Math.PI / 2);
    const groundMesh = new THREE.Mesh(groundGeom, new THREE.MeshStandardMaterial({ color: GROUND_COLOR, roughness: 0.9, transparent: true, opacity: 0.35, depthWrite: true }));
    groundMesh.position.y = gndY; groundMesh.receiveShadow = true; groundMesh.renderOrder = 0;
    groundMesh.userData = { type: "ground" };
    grp.ground.add(groundMesh);

    const gridStep = Math.ceil(span / 15 / 10) * 10 || 20;
    const gridCount = Math.round(gndSpan / gridStep);
    const gridHelper = new THREE.GridHelper(gridCount * gridStep, gridCount, "#5a5a5a", "#3e3e3e");
    gridHelper.position.y = gndY + 0.02; grp.ground.add(gridHelper);
    gridRef.current = gridHelper;
    // 场景与网格就绪后应用已保存的主题(初始化 effect 早于 theme effect,需此处补一次)
    applyTheme();

    // ── Subcatchments — thin extruded polygons, semi-transparent ──
    data.scs.forEach((sc: SC3D) => {
      if (sc.pts.length < 3) return;
      const shape = new THREE.Shape();
      sc.pts.forEach(([x, z], i) => i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z));
      const color = scColor(sc.imperv);

      // Thin fill
      const geom = new THREE.ExtrudeGeometry(shape, { steps: 1, depth: 0.015, bevelEnabled: false });
      const fill = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color, roughness: 0.75, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2; fill.position.y = gndY + 0.04; fill.renderOrder = 1;
      fill.userData = { type: "subcatchment", data: { id: sc.id, area: sc.area, imperv: sc.imperv, outlet: sc.outlet, width: sc.width, slope: sc.slope, vertices: sc.pts.length } };
      grp.sc.add(fill);

      // Thin border
      if (sc.pts.length <= 200) {
        const edgePts = sc.pts.map(([x, z]) => new THREE.Vector3(x, gndY + 0.05, z));
        edgePts.push(edgePts[0].clone());
        const edgeGeom = new THREE.BufferGeometry().setFromPoints(edgePts);
        const edgeLine = new THREE.Line(edgeGeom, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28, depthTest: true }));
        edgeLine.renderOrder = 2; grp.sc.add(edgeLine);
      }
    });

    // ── Nodes — vertical shafts, proportional ──
    data.nodes.forEach((n: Node3D) => {
      const g = new THREE.Group();
      const invertY = elevY(n.invert), groundY = elevY(n.ground);
      const shaftH = Math.max(0.12, groundY - invertY);
      const isOut = n.type === "outfall";
      const r = isOut ? OUTFALL_R : NODE_R;

      const shaftGeom = new THREE.CylinderGeometry(r, r, shaftH, 10);
      const shaftMat = new THREE.MeshStandardMaterial({ color: isOut ? OUTFALL_COLOR : NODE_COLOR, roughness: 0.4, metalness: 0.08, emissive: isOut ? OUTFALL_EMI : "#060c10", emissiveIntensity: isOut ? 0.2 : 0.05 });
      const shaft = new THREE.Mesh(shaftGeom, shaftMat);
      shaft.position.y = invertY + shaftH / 2; shaft.castShadow = true; shaft.receiveShadow = true;
      g.add(shaft);

      const topGeom = new THREE.TorusGeometry(r * 1.1, r * 0.22, 8, 10);
      const top = new THREE.Mesh(topGeom, new THREE.MeshStandardMaterial({ color: isOut ? "#c87858" : "#6a8898", emissive: isOut ? "#1a0800" : "#060c10", emissiveIntensity: 0.25, roughness: 0.2 }));
      top.position.y = groundY; top.rotation.x = Math.PI / 2;
      g.add(top);

      g.position.set(n.x, 0, n.z);
      g.userData = { type: "node", data: { id: n.id, type: n.type, invert: n.invert, ground: n.ground, maxDepth: n.maxD, initDepth: n.initD } };
      grp.nodes.add(g);
      nodeGeomMap.current.set(n.id, { group: g, invertY, groundY });
    });

    // ── Pipes — real diameter → visual radius, blue-gray ──
    data.pipes.forEach((p: Pipe3D) => {
      const fn = data.nodes.find((nn: Node3D) => nn.id === p.from);
      const tn = data.nodes.find((nn: Node3D) => nn.id === p.to);
      if (!fn || !tn) return;

      const fromY = elevY(fn.invert + 0.05), toY = elevY(tn.invert + 0.05);
      const visualR = Math.max(PIPE_MIN_R, Math.min(PIPE_MAX_R, p.diam * 0.4));
      const path: THREE.Vector3[] = [new THREE.Vector3(fn.x, fromY, fn.z)];
      p.verts.forEach(([vx, vz]) => path.push(new THREE.Vector3(vx, fromY, vz)));
      path.push(new THREE.Vector3(tn.x, toY, tn.z));
      if (path.length < 2) return;

      const curve = new THREE.CatmullRomCurve3(path);
      const tubeGeom = new THREE.TubeGeometry(curve, Math.max(6, path.length * 3), visualR, 8, false);
      const tube = new THREE.Mesh(tubeGeom, new THREE.MeshStandardMaterial({ color: PIPE_COLOR, roughness: 0.45, metalness: 0.1, emissive: PIPE_EMISSIVE, emissiveIntensity: 0.08 }));
      tube.castShadow = true; tube.receiveShadow = true;
      tube.userData = { type: "pipe", data: { id: p.id, from: p.from, to: p.to, diam: p.diam, length: p.length, roughness: p.roughness, shape: p.shape, inOffset: p.inOffset, outOffset: p.outOffset, vertCount: p.verts.length } };
      grp.pipes.add(tube);
      pipeMeshMap.current.set(p.id, tube);
      // 水流粒子(共享几何+材质):动态模式流动,静态模式慢速示意流向
      pipeEndsMap.current.set(p.id, { fx: fn.x, fy: fromY, fz: fn.z, tx: tn.x, ty: toY, tz: tn.z });
      const particle = new THREE.Mesh(SHARED.flowParticle, SHARED.flowParticleMat);
      particle.visible = false;
      particle.userData = { particle: true }; // 拾取时过滤(不参与选中/悬停)
      particle.position.set(fn.x, fromY, fn.z);
      grp.pipes.add(particle);
      flowParticleMap.current.set(p.id, particle);
    });
  }

  const rebuild = useCallback((ve: number) => { const s = sceneRef.current, d = dataRef.current; if (s && d) buildGeometry(s, d, ve); }, []);

  const toggleLayer = (id: string) => { setLayers(p => { const n = !p[id]; const g = groupsRef.current[id]; if (g) g.visible = n; return { ...p, [id]: n }; }); };

  // ═══════════════════════════════════════════════════════════
  // VIEW PRESETS
  // ═══════════════════════════════════════════════════════════
  const flyTo = (view: string) => {
    const data = dataRef.current; if (!data) return;
    let mnX=Infinity, mxX=-Infinity, mnZ=Infinity, mxZ=-Infinity;
    data.nodes.forEach((n: Node3D) => { if(n.x<mnX)mnX=n.x; if(n.x>mxX)mxX=n.x; if(n.z<mnZ)mnZ=n.z; if(n.z>mxZ)mxZ=n.z; });
    const cx = (mnX+mxX)/2, cz = (mnZ+mxZ)/2, span = Math.max(mxX-mnX, mxZ-mnZ, 50);
    const presets: Record<string, any> = {
      panorama:    { theta: 0.45, phi: 0.85, dist: span * 1.35, tx: cx, tz: cz },
      topdown:     { theta: 0,    phi: 0.08, dist: span * 1.05, tx: cx, tz: cz },
      underground: { theta: 0.35, phi: 1.1,  dist: span * 0.55, tx: cx, tz: cz },
    };
    const p = presets[view] || presets.panorama;
    Object.assign(camState.current, p);
    if (view === "panorama" || view === "topdown" || view === "underground") setCurView(view);
    if (view === "underground") {
      ["ground","sc"].forEach(k => { if (groupsRef.current[k]) groupsRef.current[k].visible = false; });
    } else {
      ["ground","sc"].forEach(k => { if (groupsRef.current[k]) groupsRef.current[k].visible = layers[k]; });
    }
    if (cameraRef.current) {
      const cs = camState.current;
      cameraRef.current.position.set(cs.tx + cs.dist * Math.sin(cs.phi) * Math.cos(cs.theta), cs.dist * Math.cos(cs.phi) * 0.65, cs.tz + cs.dist * Math.sin(cs.phi) * Math.sin(cs.theta));
      cameraRef.current.lookAt(cs.tx, cs.dist * 0.04, cs.tz);
    }
  };

  // ═══════════════════════════════════════════════════════════
  // DYNAMIC MODE — kept from working backend, visuals cleaned
  // ═══════════════════════════════════════════════════════════
  const loadSim = useCallback(async (overrideIntensity?: number, overrideLandcover?: "default" | "gray" | "green", overrideValves?: Record<string, number>, overrideGreenLevel?: number) => {
    const reqSeq = ++simSeqRef.current;
    // 取消待执行的雨强/绿色强度防抖重跑(避免旧闭包竞态覆盖新方案状态)
    if (rainTimer.current) { clearTimeout(rainTimer.current); rainTimer.current = null; }
    if (greenTimerRef.current) { clearTimeout(greenTimerRef.current); greenTimerRef.current = null; }
    setRainPreview(null);
    setDynPhase("loading"); setDynStep(0);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const simIntensity = overrideIntensity ?? (scnOf(scn)?.key === scn ? 100 : 80);
    const simLandcover = overrideLandcover ?? landcover;
    // 开始推演时把调节阀拖动的 draft 合并为正式阀门(预览→生效仅在点开始推演)
    const mergedValves: Record<string, number> = { ...valves };
    for (const [pid, k] of Object.entries(valveDraft)) if (k != null) mergedValves[pid] = k;
    const simValves = overrideValves ?? mergedValves;
    const simGreenLevel = overrideGreenLevel ?? (simLandcover === "green" ? greenLevel : undefined);
    const simSeries = scnOf(scn) ? scn : undefined;
    let tid: ReturnType<typeof setTimeout> | null = null;
    try {
      tid = setTimeout(() => ctrl.abort(), 90000);
      const res = await fetch("/api/swmm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ intensity: simIntensity, series: simSeries, landcover: simLandcover, greenLevel: simGreenLevel, valves: Object.keys(simValves).length ? simValves : undefined }), signal: ctrl.signal });
      if (tid) { clearTimeout(tid); tid = null; }
      if (abortRef.current === ctrl) abortRef.current = null;
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || "API error");
      // 竞态防护:若期间已切换方案发起新请求,丢弃本次过期结果
      if (reqSeq !== simSeqRef.current) return;
      setDynRes(d); setDynPhase("ready"); setSimId(d.simulationId || "");
      simIBaseRef.current = simIntensity;
      // 切方案/调雨强后的变化高亮(与上一结果对比)与状态条提示
      const prev = prevSimRef.current;
      prevSimRef.current = d;
      if (prev?.links && prev.simulationId !== d.simulationId) {
        const maxAbs = (arr?: number[]) => (arr && arr.length) ? Math.max(0, ...arr.map(Math.abs)) : 0;
        const diffs: Array<[string, number]> = [];
        for (const [id, ld] of Object.entries(d.links)) {
          const b = maxAbs(prev.links[id]?.flow);
          const a = maxAbs((ld as any)?.flow);
          if (Math.abs(b - a) > 1e-6) diffs.push([id, a - b]);
        }
        const top = diffs.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 5);
        if (top.length) {
          // 3D 变化百分比标签:▼ 减水(绿)/▲ 增水(橙),5s 后随高亮一并清除
          setDeltaLabels(top.map(([id, v]) => {
            const b = maxAbs(prev.links[id]?.flow);
            const pct = (b != null && Math.abs(b) > 0.01) ? (v / Math.abs(b)) * 100 : 0;
            return { id, text: `${v < 0 ? "▼" : "▲"}${Math.abs(pct).toFixed(1)}%`, color: v < 0 ? "#4ade80" : "#fb923c" };
          }));
          // 高亮交给着色 effect 统一应用(存 ref,until 后自然过期,不再被重着色覆盖)
          if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
          highlightRef.current = { top, until: Date.now() + 5000 };
          // 过期时强制清除高亮(推演静止时 effect 不再重跑,高亮不会残留);有流量的管道按 effect 公式恢复流量色,不覆盖着色
          highlightTimerRef.current = setTimeout(() => {
            highlightRef.current = null;
            highlightTimerRef.current = null;
            setDeltaLabels([]);
            const s = kbState.current;
            const maxF = s.dynRes?.summary?.maxFlow?.value || 0.1;
            top.forEach(([id]) => {
              const m = pipeMeshMap.current.get(id); if (!m) return;
              const mat = m.material as THREE.MeshStandardMaterial;
              const ld = (s.dynRes as any)?.links?.[id];
              const flows = ld?.flow;
              const caps = ld?.capacity;
              const flow = (flows && s.dynStep < flows.length) ? flows[s.dynStep] : 0;
              const capacity = (caps && s.dynStep < caps.length) ? caps[s.dynStep] : 0;
              if (Math.abs(flow) < 0.0005) { mat.color.set(PIPE_COLOR); mat.emissive.set(PIPE_EMISSIVE); mat.emissiveIntensity = 0.08; }
              else {
                // 与着色 effect 同款公式(含满管橙分支),恢复不覆盖 effect 语义
                const isFull = capacity > 0.98;
                const ratio = Math.min(1, Math.abs(flow) / maxF);
                mat.color.set(new THREE.Color().setHSL(isFull ? 0.05 : 0.55 - ratio * 0.35, 0.7, 0.4 + ratio * 0.25));
                mat.emissive.set(new THREE.Color().setHSL(isFull ? 0.05 : 0.55 - ratio * 0.35, 0.7, 0.08 + ratio * 0.12));
                mat.emissiveIntensity = isFull ? 0.5 : 0.08 + ratio * 0.4;
              }
            });
          }, 5200);
          const down = top.filter(([, v]) => v < 0).length, up = top.filter(([, v]) => v > 0).length;
          const msg = simLandcover === "green" ? `🟢 绿色海绵:${down} 条管道水量下降` : simLandcover === "gray" ? `🟠 灰色强开发:${up} 条管道水量上升` : `⚪ 已恢复现状基准`;
          setSchemeMsg({ text: msg, color: simLandcover === "green" ? "text-green-400" : simLandcover === "gray" ? "text-orange-400" : "text-gray-300" });
          if (schemeMsgTimer.current) clearTimeout(schemeMsgTimer.current);
          schemeMsgTimer.current = setTimeout(() => setSchemeMsg(null), 4000);
        }
      }
    } catch (e: any) { if (reqSeq !== simSeqRef.current) return; if (abortRef.current === ctrl) abortRef.current = null; setDynPhase("config"); if (e.name !== "AbortError") alert("仿真加载失败: " + e.message); }
    finally { if (tid) clearTimeout(tid); }
  }, [scn, landcover, valves, greenLevel]);


  const clearWaterMeshes = useCallback(() => {
    waterMeshMap.current.forEach(m => { if (m.parent) m.parent.remove(m); if (m.geometry !== SHARED.waterCyl) m.geometry?.dispose(); (m.material as THREE.Material)?.dispose(); });
    waterMeshMap.current.clear();
    pipeMeshMap.current.forEach(m => { if (m.material) { const mat = m.material as THREE.MeshStandardMaterial; mat.color.set(PIPE_COLOR); mat.emissive.set(PIPE_EMISSIVE); mat.emissiveIntensity = 0.08; } });
  }, []);

  useEffect(() => { if (!dynPlay || dynPhase !== "running" || timeStepCount === 0) return; const t = setInterval(() => { setDynStep(p => { const n = p + 1; if (n >= timeStepCount - 1) { setDynPlay(false); setDynPhase("done"); return timeStepCount - 1; } return n; }); }, 140 / dynSpd); return () => clearInterval(t); }, [dynPlay, dynSpd, dynPhase, timeStepCount]);

  useEffect(() => {
    if (!dynRes?.nodes || !dataRef.current) return;
    const ts = dynRes, nodeData = ts.nodes, linkData = ts.links;
    const ve = vertEx;
    let minElev = Infinity; dataRef.current.nodes.forEach((n: Node3D) => { if (n.invert < minElev) minElev = n.invert; });
    const elevY = (e: number) => (e - minElev) * ve;

    nodeGeomMap.current.forEach(({ group, invertY, groundY }, nid) => {
      const nd = nodeData[nid];
      const depths = nd?.depth; const depth = (depths && dynStep < depths.length) ? depths[dynStep] : 0;
      const ponding = nd?.pondedVolume?.[dynStep] ?? 0;
      const nodeInfo = dataRef.current.nodes.find((n: Node3D) => n.id === nid);
      const isOverflow = nodeInfo && depth > (nodeInfo.maxD || 99);

      let wm = waterMeshMap.current.get(nid);
      // 先清理热力图/溢流环(含 early-return 路径,防止水深回落后圆盘残留)
      const childrenToRemove = group.children.filter(c => (c as any).userData?.overflowRing);
      childrenToRemove.forEach(c => { group.remove(c); const m = c as THREE.Mesh; if (m.geometry && m.geometry !== SHARED.heatDisc && m.geometry !== SHARED.overflowRing && m.geometry !== SHARED.overflowDisc) m.geometry.dispose(); const mat = m.material as THREE.Material | undefined; if (mat) mat.dispose(); });
      if (depth < 0.003) { if (wm) wm.visible = false; return; }
      if (!wm) {
        const wGeom = SHARED.waterCyl; // 共享几何(性能:推演不再每步 new Geometry)
        const wMat = new THREE.MeshStandardMaterial({ color: "#3388cc", roughness: 0.1, metalness: 0.05, emissive: "#001122", emissiveIntensity: 0.2, transparent: true, opacity: 0.7, depthWrite: true });
        (wMat as any)._isWater = true;
        wm = new THREE.Mesh(wGeom, wMat); wm.position.set(0, invertY, 0); wm.scale.y = 0; (wm as any).userData = { water: true };
        group.add(wm); waterMeshMap.current.set(nid, wm);
      }
      wm.visible = true;
      // 雨强预览:拖动滑条时按比例缩放目标高度;否则真实仿真值(过渡由 animate 插值实现)
      const previewRatio = (rainPreview != null ? Math.max(0.05, rainPreview / simIBaseRef.current) : 1) * greenPreviewRatio;
      const wh = Math.max(0.03, depth * ve) * previewRatio;
      (wm as any).userData.targetScaleY = wh;
      (wm as any).userData.targetY = invertY + wh / 2;
      const m = wm.material as THREE.MeshStandardMaterial;
      if (ponding > 0.01 || isOverflow) { m.color.set("#e04040"); m.emissive.set("#300000"); m.emissiveIntensity = 0.4; }
      else { const ratio = Math.min(1, depth / (ts.summary?.maxDepth?.value || 1)); m.color.set(new THREE.Color().setHSL(0.57 - ratio * 0.12, 0.7, 0.35 + ratio * 0.2)); m.emissive.set("#001122"); m.emissiveIntensity = 0.15 + ratio * 0.2; }

      // 淹没/风险着色圆盘:水深模式=蓝→红热力;风险模式=黄→红风险色阶;流量模式不画
      if ((renderMode === "depth" || renderMode === "risk") && depth > 0.02) {
        const maxD = ts.summary?.maxDepth?.value || 1;
        const ratio = Math.min(1, depth / Math.max(0.05, maxD));
        const ringGeom = SHARED.heatDisc; // 共享几何
        const hue = renderMode === "risk" ? (0.15 - ratio * 0.15) : (0.62 - ratio * 0.62); // risk:黄橙红
        const sat = renderMode === "risk" ? 0.95 : 0.85;
        const ring = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.max(0, hue), sat, 0.55), transparent: true, opacity: 0.28 + ratio * 0.3, depthWrite: false }));
        ring.position.y = groundY + 0.01; ring.rotation.x = -Math.PI / 2; (ring as any).userData = { overflowRing: true };
        group.add(ring);
      }
      if (ponding > 0.01) {
        // 溢流积水圆盘:半径/透明度随地表积水体积实时涨(共享几何+scale 缩放,避免每步 new Geometry 的 GC 抖动)
        const pDisc = new THREE.Mesh(SHARED.overflowDisc, new THREE.MeshBasicMaterial({ color: "#3aa0ff", transparent: true, opacity: Math.min(0.45, 0.15 + ponding * 0.02), depthWrite: false }));
        pDisc.position.y = groundY + 0.015; pDisc.rotation.x = -Math.PI / 2;
        const r = Math.min(1.6, 0.35 + ponding * 0.08);
        pDisc.scale.set(r, r, 1);
        (pDisc as any).userData = { overflowRing: true };
        group.add(pDisc);
        // 溢流节点红环(静态环 + 闪烁由 animate 统一驱动)
        const ringGeom = SHARED.overflowRing; // 共享几何
        const ring = new THREE.Mesh(ringGeom, new THREE.MeshStandardMaterial({ color: "#e04040", emissive: "#300000", emissiveIntensity: 0.6, roughness: 0.1 }));
        ring.position.y = groundY; ring.rotation.x = Math.PI / 2; (ring as any).userData = { overflowRing: true };
        group.add(ring);
      }
    });

    pipeMeshMap.current.forEach((mesh, pid) => {
      const ld = linkData[pid]; const flows = ld?.flow; const flow = (flows && dynStep < flows.length) ? flows[dynStep] : 0;
      const cap = ld?.capacity; const capacity = (cap && dynStep < cap.length) ? cap[dynStep] : 0;
      const absFlow = Math.abs(flow); const mat = mesh.material as THREE.MeshStandardMaterial;
      // 默认/水深/风险模式:管道统一低饱和蓝灰(不随流量染色,保持界面清爽);仅「流量」模式才按流量着色
      if (renderMode !== "flow" || absFlow < 0.0005) { mat.color.set(PIPE_COLOR); mat.emissive.set(PIPE_EMISSIVE); mat.emissiveIntensity = 0.08; }
      else {
        const maxF = ts.summary?.maxFlow?.value || 0.1; const ratio = Math.min(1, absFlow / maxF);
        const isFull = capacity > 0.98;
        mat.color.set(new THREE.Color().setHSL(isFull ? 0.05 : 0.55 - ratio * 0.35, 0.7, 0.4 + ratio * 0.25));
        mat.emissive.set(new THREE.Color().setHSL(isFull ? 0.05 : 0.55 - ratio * 0.35, 0.7, 0.08 + ratio * 0.12));
        mat.emissiveIntensity = isFull ? 0.5 : 0.08 + ratio * 0.4;
      }
      // 水流溯源高亮:上游蓝/下游青(选中管道本身保持白亮),优先级高于 Δ 高亮
      const tr = traceRef.current;
      if (tr && selected?.type === "pipe") {
        if (tr.up.includes(pid)) { mat.color.set("#1e5bbf"); mat.emissive.set("#0c2a66"); mat.emissiveIntensity = 0.55; }
        else if (tr.down.includes(pid)) { mat.color.set("#1f8a8a"); mat.emissive.set("#0c3d3d"); mat.emissiveIntensity = 0.55; }
        else if (pid === selected.data.id) { mat.color.set("#ffffff"); mat.emissive.set("#666666"); mat.emissiveIntensity = 0.3; }
        else { mat.color.set("#2a2f38"); mat.emissive.set("#000000"); mat.emissiveIntensity = 0; }
        return;
      }
      // 切方案 Δ 高亮:effect 统一应用(未被重着色覆盖),until 后自然过期
      const hl = highlightRef.current;
      if (hl && Date.now() < hl.until) {
        const hit = hl.top.find(([id]) => id === pid);
        if (hit) {
          const dv = hit[1];
          mat.color.set(dv < 0 ? "#2e7d32" : "#e65100");
          mat.emissive.set(dv < 0 ? "#0f3d13" : "#5a2500");
          mat.emissiveIntensity = 0.65;
        }
      }
      // 阀门状态着色:紫色(开度越小越深紫),优先级最高
      const vk = valveDraft[pid] ?? valves[pid];
      if (vk != null) {
        const v = Math.max(0, Math.min(1, vk));
        mat.color.set(new THREE.Color().setHSL(0.75, 0.65, 0.2 + v * 0.35));
        mat.emissive.set(new THREE.Color().setHSL(0.75, 0.8, 0.06 + v * 0.16));
        mat.emissiveIntensity = 0.55;
      }
    });

    // 选中白亮
    // (蓄水设施已按 docx 意见移除)
  }, [dynStep, dynRes, vertEx, renderMode, selected, rainPreview, valves, valveDraft]);

  useEffect(() => { if (mode !== "dynamic") clearWaterMeshes(); }, [mode, clearWaterMeshes]);

  // 首次进入动态模式:仅显示一次性静态用法提示,不再强制分步引导
  useEffect(() => {
    if (mode !== "dynamic") return;
    try {
      if (!localStorage.getItem("sandbox-tip-v1")) {
        localStorage.setItem("sandbox-tip-v1", "1");
        setShowTip(true);
        setTimeout(() => setShowTip(false), 9000);
      }
    } catch { /* 隐私模式忽略 */ }
  }, [mode]);

  // 分步引导已精简:改为仅首次静态提示(见上方),不再自动强制多步
  const finishGuide = () => { setGuide(0); };
  // 引导完成后一次性提示动手玩法(仅首次)
  useEffect(() => {
    if (guide === 0) {
      try {
        if (!localStorage.getItem("sandbox-hands-v1")) {
          localStorage.setItem("sandbox-hands-v1", "1");
          setSchemeMsg({ text: "💡 点击管道看横截面与🚰调节阀 · 切换下垫面/降雨情景观察水量变化 · 推演中可拖动时间轴回看(加载后点 ▶ 开始推演)", color: "text-teal-300" });
          if (schemeMsgTimer.current) clearTimeout(schemeMsgTimer.current);
          schemeMsgTimer.current = setTimeout(() => setSchemeMsg(null), 6000);
        }
      } catch { /* 忽略 */ }
    }
  }, [guide]);

  // ─── 管道调节阀:开度预览/防抖生效/重置(与雨强滑条同「预览→重跑」模式) ───
  const valveRatio = (pid: string) => {
    const k = valveDraft[pid] ?? valves[pid];
    return k == null ? 1 : 0.3 + 0.7 * k;
  };
  // 下垫面渐变:绿色强度(0-1),仅 landcover=green 时生效;拖动即时预览(横截面/3D 水位系数),不触发 SWMM
  const onGreenLevelChange = (v: number) => {
    const lv = Math.max(0, Math.min(1, v / 100));
    setGreenLevel(lv); // 即时更新 → 横截面预览系数联动
  };
  // 绿色强度预览系数:强度越高水位越低(近似,松手后真实仿真覆盖)
  const greenPreviewRatio = (landcover === "green" && greenLevel < 1) ? (1 - 0.22 * (1 - greenLevel)) : 1;
  const onValveChange = (pid: string, v: number) => {
    const k = Math.max(0, Math.min(1, v / 100));
    setValveDraft(d => ({ ...d, [pid]: k })); // 即时预览(横截面);生效需点「开始推演」
  };
  const resetValves = (pid?: string) => {
    const nv = { ...valvesRef.current };
    if (pid) delete nv[pid]; else for (const k of Object.keys(nv)) delete nv[k];
    valvesRef.current = nv;
    setValves(nv);
    setValveDraft({});
  };

  // 卸载清理防抖/提示定时器(防卸载后 setState/fetch)
  useEffect(() => () => {
    if (rainTimer.current) clearTimeout(rainTimer.current);
    if (schemeMsgTimer.current) clearTimeout(schemeMsgTimer.current);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    if (traceTimerRef.current) clearTimeout(traceTimerRef.current);
    if (valveTimerRef.current) clearTimeout(valveTimerRef.current);
    if (greenTimerRef.current) clearTimeout(greenTimerRef.current);
  }, []);

  // 当前时间步风险统计:满管管道 / 溢流节点
  const riskStats = useMemo(() => {
    if (!dynRes?.links || !dynRes?.nodes || !dataRef.current) return null;
    return computeRiskStats(dynRes.links as Record<string, { capacity?: number[] }>, dynRes.nodes as Record<string, { depth?: number[] }>, dataRef.current?.nodes, dynStep);
  }, [dynRes, dynStep]);

  // 默认横截面管道:当前时间步充满度最大的管道(用户未选中管道时展示,互动性增强)
  const autoPipeId = useMemo(() => {
    if (!dynRes?.links || timeStepCount <= 0) return null;
    let best: string | null = null; let bestF = -1;
    for (const [id, ld] of Object.entries(dynRes.links)) {
      const f = (ld as any)?.depthFraction?.[dynStep] ?? 0;
      if (f > bestF) { bestF = f; best = id; }
    }
    return bestF > 0.001 ? best : null;
  }, [dynRes, dynStep, timeStepCount]);
  const autoPipeRef = useRef<string | null>(null);
  autoPipeRef.current = autoPipeId;

  // 选中管道 → 水流溯源:沿拓扑 BFS 上下游各 2 层(上游来水蓝/下游去水青),5s 后恢复
  useEffect(() => {
    if (traceTimerRef.current) { clearTimeout(traceTimerRef.current); traceTimerRef.current = null; }
    if (selected?.type !== "pipe" || !dataRef.current) { traceRef.current = null; return; }
    const pipes = (dataRef.current.pipes as any[]) || [];
    const byId = new Map(pipes.map(p => [p.id, p]));
    const adj = new Map<string, string[]>(); // 节点 id → 经过该节点的管道 id
    pipes.forEach(p => { adj.set(p.from, [...(adj.get(p.from) || []), p.id]); adj.set(p.to, [...(adj.get(p.to) || []), p.id]); });
    const reach = (startNode: string, dir: "up" | "down", depth = 2): string[] => {
      // 从节点出发:up=流向该节点的管道(上游来水,继续沿 p.from 走);down=从该节点流出的管道(下游去水,沿 p.to 走)
      const seen = new Set<string>(); // 已收集的管道
      let frontier = [startNode]; // 节点 id
      for (let d = 0; d < depth && frontier.length; d++) {
        const next: string[] = [];
        for (const nid of frontier) {
          for (const pid of adj.get(nid) || []) {
            if (seen.has(pid)) continue;
            const p = byId.get(pid);
            if (!p) continue;
            const flowsThrough = dir === "up" ? p.to === nid : p.from === nid;
            if (flowsThrough) {
              seen.add(pid);
              next.push(dir === "up" ? p.from : p.to);
            }
          }
        }
        frontier = next;
      }
      return [...seen];
    };
    traceRef.current = { up: reach(selected.data.from, "up"), down: reach(selected.data.to, "down") };
    // 5s 后清除溯源并手动恢复全部管道材质(按当前流量色,effect 同款公式;trace 分支曾把非溯源管道涂暗,必须全量恢复)
    traceTimerRef.current = setTimeout(() => {
      traceRef.current = null; traceTimerRef.current = null;
      const s = kbState.current;
      const maxF = s.dynRes?.summary?.maxFlow?.value || 0.1;
      pipeMeshMap.current.forEach((m, pid) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        const ld = (s.dynRes as any)?.links?.[pid];
        const flows = ld?.flow; const caps = ld?.capacity;
        const flow = (flows && s.dynStep < flows.length) ? flows[s.dynStep] : 0;
        const capacity = (caps && s.dynStep < caps.length) ? caps[s.dynStep] : 0;
        if (Math.abs(flow) < 0.0005) { mat.color.set(PIPE_COLOR); mat.emissive.set(PIPE_EMISSIVE); mat.emissiveIntensity = 0.08; }
        else {
          const isFull = capacity > 0.98;
          const ratio = Math.min(1, Math.abs(flow) / maxF);
          mat.color.set(new THREE.Color().setHSL(isFull ? 0.05 : 0.55 - ratio * 0.35, 0.7, 0.4 + ratio * 0.25));
          mat.emissive.set(new THREE.Color().setHSL(isFull ? 0.05 : 0.55 - ratio * 0.35, 0.7, 0.08 + ratio * 0.12));
          mat.emissiveIntensity = isFull ? 0.5 : 0.08 + ratio * 0.4;
        }
      });
    }, 5000);
  }, [selected]);

  // 键盘快捷键:空格 = 播放/暂停,←/→ = 步进(仅动态模式且有结果,且焦点不在输入控件)
  // 用 ref 保存最新状态,监听器只绑定一次,避免推演播放时每步重建
  const kbState = useRef({ mode, dynRes, timeStepCount, dynPhase, dynPlay, dynStep });
  kbState.current = { mode, dynRes, timeStepCount, dynPhase, dynPlay, dynStep };
  // 悬停 tooltip 读取最新仿真结果(初始化 effect 闭包需 ref 而非 state)
  const dynResRef = useRef<any>(null);
  dynResRef.current = dynRes;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t instanceof Element && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || !!t.closest("button, [role=button], a, [tabindex]"))) return;
      const s = kbState.current;
      if (s.mode !== "dynamic" || !s.dynRes?.ok || s.timeStepCount <= 0) return;
      if (e.code === "Space") { e.preventDefault(); if (s.dynPhase === "running") { setDynPlay(false); setDynPhase("paused"); } else if (s.dynPhase === "paused" || s.dynPhase === "ready" || s.dynPhase === "done") { if (s.dynPhase === "done" && s.dynStep >= s.timeStepCount - 1) setDynStep(0); setDynPlay(true); setDynPhase("running"); } }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setDynStep(v => Math.max(0, v - 1)); if (s.dynPlay) { setDynPlay(false); setDynPhase("paused"); } }
      else if (e.key === "ArrowRight") { e.preventDefault(); setDynStep(v => Math.min(s.timeStepCount - 1, v + 1)); if (s.dynPlay) { setDynPlay(false); setDynPhase("paused"); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Dynamic property data ──
  const curNodeData = (mode === "dynamic" && selected?.type === "node" && dynRes?.nodes) ? dynRes.nodes[selected.data.id] : null;
  const curLinkData = (mode === "dynamic" && selected?.type === "pipe" && dynRes?.links) ? dynRes.links[selected.data.id] : null;
  // Links now use velocity + depthFraction (not flow) — correct SWMM per-step API

  // 组件级:最满管道列表(数量可配 2-6;选中置顶),供 TopN 区块共用
  const topPipes = (() => {
    const links = dynRes?.links;
    if (!links) return [];
    const entries = Object.entries(links as Record<string, any>).map(([id, ld]) => {
      const pp = (dataRef.current?.pipes as any)?.find?.((p: any) => p.id === id);
      // 按全曲线最大充满度排序(ready 态 t=0 充满度≈0 也能显示 Top3)
      const dfArr = ld?.depthFraction || [];
      const df = dfArr.length ? Math.max(0, ...dfArr) : 0;
      return { id, df, diam: pp?.diam || 0.3, from: pp?.from ?? "?", to: pp?.to ?? "?" };
    }).filter(x => x.df > 0.001);
    entries.sort((a, b) => b.df - a.df);
    const top = entries.slice(0, Math.max(2, Math.min(6, pipeCount)));
    if (selected?.type === "pipe" && top.length && !top.find(t => t.id === selected.data.id)) {
      const sel = entries.find(e => e.id === selected.data.id);
      if (sel) { top.pop(); top.unshift(sel); }
    }
    return top;
  })();
  // 自选管道模式:customPipes 非空时按 id 映射(缺失跳过,保序),否则自动 TopN
  const shownPipes = customPipes.length
    ? customPipes.map(id => { const ld = (dynRes?.links as Record<string, any>)?.[id]; if (!ld) return null; const pp = (dataRef.current?.pipes as any)?.find?.((p: any) => p.id === id); const dfArr = ld.depthFraction || []; const df = dfArr.length ? Math.max(0, ...dfArr) : 0; return { id, df, diam: pp?.diam || 0.3, from: pp?.from ?? "?", to: pp?.to ?? "?" }; }).filter((x): x is NonNullable<typeof x> => x != null)
    : topPipes;
  // 自选面板候选:全管道按峰值充满度降序
  const pickCandidates = (() => {
    const links = dynRes?.links;
    if (!links) return [];
    const entries = Object.entries(links as Record<string, any>).map(([id, ld]) => { const dfArr = ld?.depthFraction || []; return { id, df: dfArr.length ? Math.max(0, ...dfArr) : 0 }; }).filter(x => x.df > 0.001);
    entries.sort((a, b) => b.df - a.df);
    return entries.slice(0, 20);
  })();
  // 推演中 TopN 自动轮流高亮(3s/根,不打断用户选中;大图/侧边高亮随之切换)
  useEffect(() => {
    if (dynPhase !== "running" || shownPipes.length < 1) return;
    const iv = setInterval(() => setAutoFocusIdx(i => i + 1), 3000);
    return () => clearInterval(iv);
  }, [dynPhase, shownPipes.length, customPipes.length]);
  const focusId = (dynPhase === "running" && shownPipes.length > 0) ? shownPipes[autoFocusIdx % shownPipes.length].id : null;
  useEffect(() => { if (dynPhase === "running") highlightPipe3D(focusId); else highlightPipe3D(null); }, [focusId, dynPhase]);

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-black relative">
      {/* ── Top bar ── */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-black/90 backdrop-blur border-b border-gray-800 px-2 py-1 flex items-center gap-2 text-[11px]">
        <span className="font-bold text-gray-200 text-xs shrink-0">🌊 紫荆雅园</span>
        <div className="flex bg-gray-800 rounded-lg p-0.5 shrink-0">
          <button onClick={() => { setMode("static"); clearWaterMeshes(); }} className={"px-3 py-1 rounded-md font-bold text-xs " + (mode === "static" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white")}>📐 静态沙盘</button>
          <button onClick={() => setMode("dynamic")} className={"px-3 py-1 rounded-md font-bold text-xs " + (mode === "dynamic" ? "bg-cyan-600 text-white" : "text-gray-400 hover:text-white")}>▶ 动态推演</button>
        </div>
        <div className="h-4 w-px bg-gray-600" />
        {/* 渲染 Popover */}
        <div className="relative">
          <button onClick={() => setOpenBar(openBar === "render" ? null : "render")} className={"px-2 py-1 rounded-md font-bold text-xs " + (openBar === "render" ? "bg-gray-700 text-white" : "text-gray-300 hover:bg-gray-800")}>渲染 · {{ default: "默认", depth: "水深", flow: "流量", risk: "风险" }[renderMode]} ▾</button>
          {openBar === "render" && (
            <div className="absolute left-0 top-full mt-1 bg-gray-900/95 backdrop-blur rounded-lg border border-gray-700 shadow-xl p-1 w-32 z-30">
              {([["default","◉ 默认"],["depth","◉ 水深"],["flow","◉ 流量"],["risk","◉ 风险"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => { setRenderMode(v); setHeatmap(v === "depth"); setOpenBar(null); }} className={"block w-full text-left px-2 py-1.5 rounded text-[11px] " + (renderMode === v ? "text-cyan-300 font-bold bg-cyan-900/30" : "text-gray-300 hover:bg-gray-800")}>{l}</button>
              ))}
            </div>
          )}
        </div>
        {/* 视角 Popover */}
        <div className="relative">
          <button onClick={() => setOpenBar(openBar === "view" ? null : "view")} className={"px-2 py-1 rounded-md font-bold text-xs " + (openBar === "view" ? "bg-gray-700 text-white" : "text-gray-300 hover:bg-gray-800")}>视角 · {{ panorama: "鸟瞰", topdown: "俯视", underground: "地下" }[curView]} ▾</button>
          {openBar === "view" && (
            <div className="absolute left-0 top-full mt-1 bg-gray-900/95 backdrop-blur rounded-lg border border-gray-700 shadow-xl p-1 w-28 z-30">
              {([["panorama","鸟瞰"],["topdown","俯视"],["orbit","环绕"],["reset","复位"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => { if (v === "orbit") setOrbit(o => { orbitRef.current = !o; return !o; }); else if (v === "reset") { setOrbit(false); orbitRef.current = false; flyTo("panorama"); } else flyTo(v); setOpenBar(null); }} className={"block w-full text-left px-2 py-1.5 rounded text-[11px] hover:bg-gray-800 text-gray-300 " + (v === "orbit" && orbit ? "text-cyan-300 font-bold" : "")}>{l}</button>
              ))}
            </div>
          )}
        </div>
        {/* 组成 Popover */}
        <div className="relative">
          <button onClick={() => setOpenBar(openBar === "layer" ? null : "layer")} className={"px-2 py-1 rounded-md font-bold text-xs " + (openBar === "layer" ? "bg-gray-700 text-white" : "text-gray-300 hover:bg-gray-800")}>组成 ▾</button>
          {openBar === "layer" && (
            <div className="absolute left-0 top-full mt-1 bg-gray-900/95 backdrop-blur rounded-lg border border-gray-700 shadow-xl p-1 w-32 z-30">
              {[{ id: "ground", l: "地表" },{ id: "sc", l: "汇水区" },{ id: "pipes", l: "管道" },{ id: "nodes", l: "节点" }].map(({ id, l }) => (
                <button key={id} onClick={() => toggleLayer(id)} className={"block w-full text-left px-2 py-1.5 rounded text-[11px] " + (layers[id] ? "text-gray-100 font-bold" : "text-gray-500")}>{layers[id] ? "☑ " : "☐ "}{l}</button>
              ))}
            </div>
          )}
        </div>
        <span className="ml-auto text-[9px] text-gray-500 shrink-0">{stats.nodes}节点 · {stats.pipes}管 · {stats.scs}汇水区</span>
      </div>

      {/* ── Three.js canvas + 3D 悬浮迷你横截面 + 放大模态 ── */}
      <div className="relative flex-1 ml-[17.5rem]">
        <div ref={cr} className="absolute inset-0" />
        {floatPipeId && (() => {
          const ld = (dynRes?.links as any)?.[floatPipeId];
          const pp = (dataRef.current?.pipes as any)?.find?.((p: any) => p.id === floatPipeId);
          if (!ld) return null;
          return (
            <div ref={floatRef} className="absolute hidden z-20 pointer-events-none -translate-x-1/2 -translate-y-full" style={{ left: 0, top: 0 }}>
              <div className="bg-black/85 backdrop-blur rounded-md border border-cyan-700/60 p-1 shadow-lg">
                <div className="text-[8px] text-cyan-300 font-bold mb-0.5 text-center">{floatPipeId} · {((ld.depthFraction?.[dynStep] ?? 0) * 100).toFixed(0)}%</div>
                <PipeCrossSection
                  diam={pp?.diam || 0.3}
                  depth={ld.depth?.[dynStep] ?? 0}
                  depthFraction={ld.depthFraction?.[dynStep] ?? 0}
                  flow={ld.flow?.[dynStep] ?? 0}
                  flowDir={`${pp?.from ?? "?"} → ${pp?.to ?? "?"}`}
                  landcover={landcover}
                  previewRatio={(rainPreview != null ? Math.max(0.05, rainPreview / simIBaseRef.current) : 1) * greenPreviewRatio * valveRatio(floatPipeId)}
                  compact
                />
              </div>
            </div>
          );
        })()}
        {deltaLabels.map(l => (
          <div key={l.id} ref={el => { if (!el) return; let it = deltaLabelsRef.current.find(x => x.id === l.id); if (!it) { it = { id: l.id, el: null }; deltaLabelsRef.current.push(it); } it.el = el; }} className="absolute hidden z-30 pointer-events-none -translate-x-1/2 -translate-y-full" style={{ left: 0, top: 0 }}>
            <div className="bg-black/80 border border-gray-600 rounded px-1 py-0.5 text-[10px] font-bold shadow" style={{ color: l.color }}>{l.text}</div>
          </div>
        ))}
        {customOpen && (
          <div className="absolute right-3 top-16 z-40 w-[300px] bg-gray-950/95 border border-gray-700 rounded-lg shadow-2xl">
            <div className="flex items-center justify-between px-2 py-1 bg-gray-900 border-b border-gray-700">
              <span className="font-bold text-xs text-teal-300">➕ 自选管道(最多 6 条)</span>
              <button onClick={() => setCustomOpen(false)} className="text-gray-400 hover:text-white text-xs px-1">✕</button>
            </div>
            <div className="max-h-[260px] overflow-y-auto p-1.5 space-y-0.5">
              {pickCandidates.map(c => {
                const on = customPipes.includes(c.id);
                return (
                  <label key={c.id} className="flex items-center gap-1.5 text-[10px] cursor-pointer hover:bg-gray-800 rounded px-1 py-0.5">
                    <input type="checkbox" checked={on} disabled={!on && customPipes.length >= 6} onChange={() => setCustomPipes(prev => on ? prev.filter(x => x !== c.id) : prev.length >= 6 ? prev : [...prev, c.id])} className="accent-teal-500" />
                    <span className={on ? "text-teal-300 font-bold" : "text-gray-300"}>{c.id}</span>
                    <span className="text-gray-500 ml-auto">{c.df > 0 ? (c.df * 100).toFixed(0) + "%" : ""}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex gap-1 p-1.5 border-t border-gray-700">
              <button onClick={() => { setCustomPipes([]); setCustomOpen(false); }} className="flex-1 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[10px] font-bold text-gray-300">清除(回自动 TopN)</button>
              <button onClick={() => setCustomOpen(false)} className="flex-1 py-1 bg-teal-800 hover:bg-teal-700 rounded text-[10px] font-bold text-white">确定({customPipes.length}/6)</button>
            </div>
          </div>
        )}
        {bigView && (() => {
          const bid = (selected?.type === "pipe" ? selected.data.id : null) || focusId || topPipes[0]?.id || null;
          if (!bid) return null;
          if (dynPhase !== "running") highlightPipe3D(bid); // 非推演时大图管道常驻高亮
          const ld = (dynRes?.links as any)?.[bid];
          const pp = (dataRef.current?.pipes as any)?.find?.((p: any) => p.id === bid);
          return (
            <div className="absolute right-3 top-16 z-40 w-[430px] max-w-[90%] bg-gray-950/95 border border-gray-700 rounded-lg shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-2 py-1 bg-gray-900 border-b border-gray-700">
                <span className="font-bold text-xs text-cyan-300">🔍 横截面大图 · {bid}</span>
                <span className="text-[9px] text-gray-500">滚轮缩放 · 拖动平移</span>
                <button onClick={() => setBigView(false)} className="text-gray-400 hover:text-white text-xs px-1">✕</button>
              </div>
              <div className="relative h-[300px] overflow-hidden" onWheel={e => setBigZoom(z => Math.max(1, Math.min(3, z - Math.sign(e.deltaY) * 0.15)))} onMouseDown={e => { bigDragRef.current = { sx: e.clientX, sy: e.clientY, px: bigPos.x, py: bigPos.y }; }} onMouseMove={e => { const d = bigDragRef.current; if (d) setBigPos({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) }); }} onMouseUp={() => { bigDragRef.current = null; }} onMouseLeave={() => { bigDragRef.current = null; }}>
                <div className="absolute inset-0 flex items-center justify-center" style={{ transform: `translate(${bigPos.x}px, ${bigPos.y}px) scale(${bigZoom})` }}>
                  <PipeCrossSection
                    diam={pp?.diam || 0.3}
                    depth={ld?.depth?.[dynStep] ?? 0}
                    depthFraction={ld?.depthFraction?.[dynStep] ?? 0}
                    flow={ld?.flow?.[dynStep] ?? 0}
                    flowDir={`${pp?.from ?? "?"} → ${pp?.to ?? "?"}`}
                    landcover={landcover}
                    previewRatio={(rainPreview != null ? Math.max(0.05, rainPreview / simIBaseRef.current) : 1) * greenPreviewRatio * valveRatio(bid)}
                    size="lg"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between px-2 py-1 bg-gray-900 border-t border-gray-700 text-[10px]">
                <span className="text-gray-400">充满度 <span className="text-cyan-300 font-bold">{(ld?.depthFraction?.[dynStep] ?? 0) * 100}%</span></span>
                <span className="text-gray-400">流量 <span className="text-cyan-300 font-bold">{(ld?.flow?.[dynStep] ?? 0).toFixed(2)} m³/s</span></span>
                <span className="text-gray-500">缩放 {bigZoom.toFixed(1)}x</span>
                <button onClick={() => { setBigZoom(1); setBigPos({ x: 0, y: 0 }); }} className="text-gray-400 hover:text-cyan-300">↺ 复位</button>
              </div>
            </div>
          );
        })()}
        {zoomPipeId && (() => {
          const ld = (dynRes?.links as any)?.[zoomPipeId];
          const pp = (dataRef.current?.pipes as any)?.find?.((p: any) => p.id === zoomPipeId);
          if (!ld) return null;
          return (
            <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center" onClick={() => setZoomPipeId(null)}>
              <div onClick={e => e.stopPropagation()} className="bg-gray-900 rounded-lg border border-gray-600 p-3 shadow-2xl">
                <div className="flex items-center justify-between mb-2 gap-6">
                  <span className="font-bold text-sm text-gray-200">🔵 {zoomPipeId} 横截面放大</span>
                  <span className="text-[10px] text-gray-500">{pp ? `${pp.from} → ${pp.to}` : ""} · {landcover === "green" ? "🟢 绿色海绵" : landcover === "gray" ? "🟠 灰色强开发" : "⚪ 现状"}</span>
                  <button onClick={() => setZoomPipeId(null)} className="text-gray-400 hover:text-white text-sm">✕</button>
                </div>
                <PipeCrossSection
                  diam={pp?.diam || 0.3}
                  depth={ld.depth?.[dynStep] ?? 0}
                  depthFraction={ld.depthFraction?.[dynStep] ?? 0}
                  flow={ld.flow?.[dynStep] ?? 0}
                  flowDir={`${pp?.from ?? "?"} → ${pp?.to ?? "?"}`}
                  landcover={landcover}
                  previewRatio={(rainPreview != null ? Math.max(0.05, rainPreview / simIBaseRef.current) : 1) * greenPreviewRatio * valveRatio(zoomPipeId)}
                  onCanvas={setSnapCanvas}
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={downloadSnap} className="flex-1 py-1.5 bg-cyan-800 hover:bg-cyan-700 rounded text-xs font-bold text-white">📷 下载 PNG</button>
                  <button onClick={() => setZoomPipeId(null)} className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-bold text-gray-200">关闭</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── STATIC property panel — all Chinese ── */}
      {mode === "static" && selected && (
        <div className="absolute right-2 top-14 bg-black/90 backdrop-blur rounded-lg border border-gray-700 p-2.5 text-white text-[11px] z-10 w-52 max-h-[80vh] overflow-y-auto">
          <div className="font-bold text-gray-300 mb-1.5 text-xs flex justify-between">
            <span>{{ node: "🔹 节点", pipe: "▬ 管道", subcatchment: "▨ 汇水区" }[selected.type as string] || selected.type}</span>
            <button onClick={() => { if (selRef.current) resetHL(selRef.current); selRef.current = null; setSelected(null); }} className="text-gray-500 hover:text-gray-300 text-[10px]">✕</button>
          </div>
          <div className="space-y-0.5">
            {selected.type === "pipe" && (
              <div className="mb-1.5">
                <PipeCrossSection
                  diam={selected.data.diam || 0.3}
                  depth={0}
                  depthFraction={0}
                  flow={0}
                  flowDir={`${selected.data.from ?? "?"} → ${selected.data.to ?? "?"}`}
                  landcover="default"
                  animate={false}
                  compact
                />
                <div className="text-[8px] leading-3 text-cyan-400/80 mt-0.5">静态示意 · 切「▶ 动态推演」看实时水量变化</div>
              </div>
            )}
            {Object.entries(selected.data).map(([k, v]: [string, any]) => (
              <div key={k} className="flex justify-between">
                <span className="text-gray-500">{chineseLabel(k)}</span>
                <span className="text-gray-200 text-right ml-2">{k === "type" ? chineseType(String(v)) : formatVal(k, v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DYNAMIC 场景配置 — 左侧独立区块(清单 5 区 IA) ── */}
      {mode === "dynamic" && (
        <div className="absolute left-0 top-[38px] bottom-[148px] w-[17.5rem] bg-black/90 backdrop-blur rounded-r-lg border-y border-r border-gray-700 p-2.5 text-white text-[11px] z-10 overflow-y-auto">
          <div className="font-bold text-gray-300 mb-2 text-xs">
            {{ config: "⚙️ 场景配置", loading: "⏳ 加载中…", ready: "📊 就绪", running: "🔵 运行中", paused: "⏸ 暂停", done: "✅ 完成" }[dynPhase]}
            {selected && (<button onClick={() => { if (selRef.current) resetHL(selRef.current); selRef.current = null; setSelected(null); }} className="float-right text-gray-500 text-[10px]">✕</button>)}
          </div>

          {(dynPhase === "config" || dynPhase === "ready" || dynPhase === "done") && (
            <div className="space-y-2">
              {/* 降雨情景:真实设计暴雨重现期 3/5/10/20/50 年,展示真实累计/峰值/时长/曲线 */}
              <div className={guide === 3 ? "rounded-lg ring-2 ring-yellow-400/80 p-1" : ""}>
                <div className="mb-1 text-[10px] text-gray-500 flex items-center gap-1">🌧 降雨情景(重现期)
                  <span className="relative group cursor-help">
                    <span className="text-cyan-500 text-[10px]">ⓘ</span>
                    <span className="absolute left-0 top-full mt-1 z-30 hidden group-hover:block bg-gray-900/97 border border-gray-700 rounded-md px-2.5 py-2 text-[9px] leading-4 text-gray-300 w-56 shadow-xl">重现期表示该强度降雨在统计意义上的发生频率。例如 5 年一遇并不是“每 5 年一定发生一次”，而是表示该强度降雨每年的超越概率约为 20%。</span>
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {RAIN_SCENARIOS.map(s => (
                    <button key={s.key} onClick={() => { if (s.key === scn) return; setScn(s.key); setRainPreview(null); }} title={s.desc} className={`py-1 rounded text-[10px] font-bold transition-colors ${scn === s.key ? "bg-blue-700 text-white ring-1 ring-blue-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>{s.label.replace("一遇","").replace("年","")}</button>
                  ))}
                </div>
                {scnOf(scn) && (() => {
                  const s = scnOf(scn)!;
                  return (
                    <>
                      <div className="mt-1.5 rounded bg-blue-950/30 border border-blue-900/50 px-2 py-1.5 text-[10px] space-y-0.5">
                        <div className="font-bold text-cyan-300">{s.label}</div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                          <div className="flex justify-between" title="全过程累计降雨量"><span className="text-gray-500">总降雨量</span><span className="text-gray-100">{s.totalRainfall.toFixed(1)} mm</span></div>
                          <div className="flex justify-between" title="峰值降雨强度"><span className="text-gray-500">峰值雨强</span><span className="text-gray-100">{s.peakIntensity.toFixed(1)} mm/h</span></div>
                          <div className="flex justify-between" title="第一个非零降雨点到最后一个非零降雨点之间的时长"><span className="text-gray-500">降雨历时</span><span className="text-gray-100">{s.durationH.toFixed(1)} h</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">峰值时刻</span><span className="text-gray-100">{s.peakTime}</span></div>
                        </div>
                      </div>
                      {/* 降雨过程曲线(真实时序,ECharts:坐标轴/mm·h⁻¹/hover/峰值/当前时刻线) */}
                      <div className="mt-1 rounded bg-blue-950/30 border border-blue-900/40 overflow-hidden" style={{ height: 132 }}>
                        <ReactEChartsCore echarts={echarts} option={rainChartOption(s, dynRes?.ok && dynStep > 0)} style={{ height: 132, width: "100%" }} notMerge />
                      </div>
                    </>
                  );
                })()}
              </div>
              {/* 下垫面方案切换(方案2):点击改变下垫面→重新仿真→横截面水量变化 */}
              <div className={guide === 2 ? "rounded-lg ring-2 ring-yellow-400/80 p-1" : ""}>
                <div className="mb-1 text-[10px] text-gray-500">🏞 下垫面方案</div>
                <div className="grid grid-cols-1 gap-1">
                  {([["default", "⚪ 现状方案", "不透水率按模型原始值"], ["green", "🟢 海绵提升方案", "降低不透水率 · 透水性增强"], ["gray", "🟠 高开发方案", "提高不透水率 · 地表更硬化"]] as const).map(([val, label, hint]) => (
                    <button key={val} onClick={() => { if (val === landcover) return; clearTimeout(greenTimerRef.current ?? undefined); greenTimerRef.current = null; setLandcover(val); setRainPreview(null); }} className={`flex items-center justify-between px-2 py-1.5 rounded text-[10px] font-bold transition-colors ${landcover === val ? (val === "green" ? "bg-green-700/80 text-white ring-1 ring-green-400" : val === "gray" ? "bg-orange-700/80 text-white ring-1 ring-orange-400" : "bg-gray-600 text-white ring-1 ring-gray-400") : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                      <span>{label}</span>
                      <span className="text-[8px] font-normal opacity-80">{hint}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-0.5 text-[8px] leading-3 text-gray-600">方案通过调整各汇水区不透水率(%Imperv)与不透水糙率(N-Imperv)真实改变地表径流 · 空间细节为示意图,非精确设施位置</div>
                {landcover === "green" && (
                  <div className="mt-1 rounded bg-green-950/40 border border-green-900/60 p-1.5">
                    <div className="flex justify-between text-[9px] mb-0.5"><span className="text-green-400/80">🌿 绿色强度(渐变)</span><span className="text-green-300 font-bold">{Math.round(greenLevel * 100)}%</span></div>
                    <input type="range" min="0" max="100" step="5" value={Math.round(greenLevel * 100)} onChange={e => onGreenLevelChange(Number(e.target.value))} className="w-full accent-green-500" />
                    <div className="flex justify-between text-[8px] text-gray-500"><span>现状</span><span>全绿色</span></div>
                  </div>
                )}
              </div>
              {dynPhase === "config" && <button onClick={() => loadSim()} className="w-full py-2 bg-green-600 rounded font-bold text-sm text-white ring-2 ring-green-400/70 shadow-lg shadow-green-900/50 hover:bg-green-500 transition-colors animate-pulse">▶ 开始推演</button>}
              {dynPhase === "done" && <button onClick={() => { setDynStep(0); setDynPlay(true); setDynPhase("running"); }} className="w-full py-1.5 bg-green-800 rounded font-bold text-xs hover:bg-green-700">🔄 重新推演</button>}
              {dynPhase === "ready" && <button onClick={() => { setDynPhase("running"); setDynPlay(true); setDynStep(0); }} className="w-full py-2 bg-green-600 rounded font-bold text-sm text-white ring-2 ring-green-400/70 shadow-lg shadow-green-900/50 hover:bg-green-500 transition-colors animate-pulse">▶ 开始推演</button>}
            </div>
          )}

          {dynPhase === "running" && (
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-gray-500">当前时间</span><span className="text-gray-200 font-bold font-mono">{currentTimeLabel}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">进度</span><span className="text-gray-200">{timeStepCount > 1 ? Math.round((dynStep / Math.max(1, timeStepCount - 1)) * 100) : 100}%</span></div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800"><div className="h-full rounded-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-[width] duration-150" style={{ width: `${((dynStep + 1) / Math.max(1, timeStepCount)) * 100}%` }} /></div>
              <div className="flex justify-between"><span className="text-gray-500">最大水深</span><span className="text-gray-200">{dynRes?.summary?.maxDepth?.value?.toFixed(2)} m</span></div>
              <div className="flex gap-1.5">
                <button onClick={() => { setDynPlay(false); setDynPhase("paused"); }} className="flex-1 py-1.5 bg-yellow-800 rounded font-bold text-xs hover:bg-yellow-700">⏸ 暂停</button>
                <button onClick={() => { setDynPlay(false); setDynPhase("done"); }} className="flex-1 py-1.5 bg-red-800 rounded font-bold text-xs hover:bg-red-700">⏹ 停止</button>
              </div>
            </div>
          )}

          {dynPhase === "paused" && (
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-gray-500">当前时间</span><span className="text-gray-200 font-mono">{currentTimeLabel}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">进度</span><span className="text-gray-200">{(dynStep/Math.max(1,timeStepCount-1)*100).toFixed(0)}%</span></div>
              <div className="flex gap-1.5">
                <button onClick={() => { setDynPlay(true); setDynPhase("running"); }} className="flex-1 py-1.5 bg-green-800 rounded font-bold text-xs hover:bg-green-700">▶ 继续</button>
                <button onClick={() => setDynPhase("done")} className="flex-1 py-1.5 bg-red-800 rounded font-bold text-xs hover:bg-red-700">⏹ 停止</button>
              </div>
            </div>
          )}

          {dynPhase === "loading" && <div className="text-center py-3"><div className="animate-spin text-lg mb-1">⏳</div><div className="text-[10px] text-gray-400">运行 SWMM 仿真…</div><button onClick={() => { abortRef.current?.abort(); setDynPhase("config"); }} className="mt-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-gray-300">✕ 取消</button></div>}

          {(dynPhase === "running" || dynPhase === "paused" || dynPhase === "done" || dynPhase === "ready") && shownPipes.length > 0 && (() => {
            const links = dynRes?.links as Record<string, any>;
            const ldOf = (id: string) => links[id];
            return (
            <div className="border-t border-gray-700 mt-2 pt-1.5">
              <div className="flex items-center justify-between mb-1">
                <div className="font-bold text-xs text-gray-300">🔵 管网横截面 <span className="ml-1 text-[9px] font-normal text-cyan-400">{customPipes.length ? `自选 ${customPipes.length} 条` : `最满 Top${shownPipes.length}`} · 点击切换</span></div>
                <div className="flex items-center gap-1">
                  {dynPhase === "ready" && dynStep === 0 ? <span className="text-[8px] text-yellow-400/90">初始时刻</span> : selected?.type === "pipe" ? <span className="text-[9px] text-gray-500">{selected.data.id} 置顶</span> : null}
                  <button onClick={() => setBigView(v => !v)} className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${bigView ? "bg-cyan-700 text-white" : "bg-gray-800 text-cyan-400 hover:bg-gray-700"}`}>🔍 大图</button>
                  {!customPipes.length && (
                    <button onClick={() => setPipeCount(c => Math.max(2, c - 1))} className="text-[9px] px-1 bg-gray-800 text-gray-400 rounded hover:bg-gray-700" title="减少管道">−</button>
                  )}
                  <button onClick={() => setCustomOpen(true)} className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${customPipes.length ? "bg-teal-700 text-white" : "bg-gray-800 text-teal-400 hover:bg-gray-700"}`}>➕ 自选</button>
                  {!customPipes.length && (
                    <button onClick={() => setPipeCount(c => Math.min(6, c + 1))} className="text-[9px] px-1 bg-gray-800 text-gray-400 rounded hover:bg-gray-700" title="增加管道">+</button>
                  )}
                </div>
              </div>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(6, shownPipes.length)}, minmax(0, 1fr))` }}>
                {shownPipes.map((p) => {
                  const hl = highlightRef.current;
                  const inHl = hl && Date.now() < hl.until && hl.top.some(([id]) => id === p.id);
                  return (
                  <button key={p.id} onClick={() => { const mesh = pipeMeshMap.current.get(p.id); if (mesh) { if (selRef.current !== mesh) { if (selRef.current) resetHL(selRef.current); selRef.current = mesh; hlObj(mesh); setSelected({ type: "pipe", data: { ...(mesh.userData?.data || {}), id: p.id } }); } } }} onMouseEnter={() => highlightPipe3D(p.id)} onMouseLeave={() => { if (dynPhase !== "running") highlightPipe3D(null); }} className={`text-left rounded ${inHl ? "ring-2 ring-amber-400 animate-pulse" : ""} ${focusId === p.id ? "ring-1 ring-cyan-400" : ""}`} title={`${p.id} ${p.from}→${p.to} 充满度 ${(p.df * 100).toFixed(0)}%`}>
                    <div className="text-[8px] text-gray-400 truncate">{p.id}</div>
                    <PipeCrossSection
                      diam={p.diam}
                      depth={(ldOf(p.id).depth?.[dynStep] ?? 0)}
                      depthFraction={p.df}
                      flow={ldOf(p.id).flow?.[dynStep] ?? 0}
                      flowDir={`${p.from} → ${p.to}`}
                      landcover={landcover}
                      previewRatio={(rainPreview != null ? Math.max(0.05, rainPreview / simIBaseRef.current) : 1) * greenPreviewRatio * valveRatio(p.id)}
                      compact
                    />
                  </button>
                  );
                })}
              </div>
            </div>
            );
          })()}

          {/* Dynamic property for selected object */}
          {selected && (dynPhase === "running" || dynPhase === "paused" || dynPhase === "done" || dynPhase === "ready") && (
            <div className="border-t border-gray-700 mt-2 pt-1.5 space-y-0.5 text-[10px]">
              <div className="font-bold text-xs text-gray-300 mb-1">{{ node: "🔹 " + selected.data.id, pipe: "▬ " + selected.data.id }[selected.type as string]}</div>
              {selected.type === "node" && curNodeData && (<>
                <div className="flex justify-between"><span className="text-gray-500">当前水深</span><span className="text-gray-200">{(curNodeData.depth?.[dynStep]??0).toFixed(3)} m</span></div>
                <div className="flex justify-between"><span className="text-gray-500">总入流</span><span className="text-gray-200">{(curNodeData.totalInflow?.[dynStep]??0).toFixed(3)} m³/s</span></div>
                <div className="flex justify-between"><span className="text-gray-500">地表积水体积</span><span className={(curNodeData.pondedVolume?.[dynStep]??0)>0.01?"text-red-400":"text-gray-200"}>{(curNodeData.pondedVolume?.[dynStep]??0).toFixed(3)} m³</span></div>
                <div className="flex justify-between"><span className="text-gray-500">洪泛损失</span><span className={(curNodeData.floodingLosses?.[dynStep]??0)>0.01?"text-red-400":"text-gray-200"}>{(curNodeData.floodingLosses?.[dynStep]??0).toFixed(3)}</span></div>
              </>)}
              {selected.type === "pipe" && curLinkData && (<>
                <div className="flex justify-between"><span className="text-gray-500">当前流量</span><span className="text-gray-200">{(curLinkData.flow?.[dynStep]??0).toFixed(3)} m³/s</span></div>
                <div className="flex justify-between"><span className="text-gray-500">当前流速</span><span className="text-gray-200">{(curLinkData.velocity?.[dynStep]??0).toFixed(3)} m/s</span></div>
                <div className="flex justify-between"><span className="text-gray-500">水深</span><span className="text-gray-200">{(curLinkData.depth?.[dynStep]??0).toFixed(3)} m</span></div>
                <div className="flex justify-between"><span className="text-gray-500">充满度</span><span className="text-gray-200">{((curLinkData.depthFraction?.[dynStep]??0)*100).toFixed(0)}%</span></div>
                <div className="flex justify-between"><span className="text-gray-500">容量利用率</span><span className="text-gray-200">{(curLinkData.capacity?.[dynStep]??0).toFixed(3)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">流向</span><span className="text-gray-200">{(curLinkData.flow?.[dynStep]??0)>=0 ? "→ "+selected.data.to : "← "+selected.data.from}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">状态</span><span className="text-gray-200">{(curLinkData.capacity?.[dynStep]??0)>0.98?"满管":(curLinkData.depthFraction?.[dynStep]??0)>0.5?"高负荷":"正常"}</span></div>
                {/* 管网横截面水量展示(方案1) */}
                <PipeCrossSection
                  diam={selected.data.diam || 0.3}
                  depth={curLinkData.depth?.[dynStep] ?? 0}
                  depthFraction={curLinkData.depthFraction?.[dynStep] ?? 0}
                  flow={curLinkData.flow?.[dynStep] ?? 0}
                  flowDir={`${selected.data.from} → ${selected.data.to}`}
                  landcover={landcover}
                  previewRatio={(rainPreview != null ? Math.max(0.05, rainPreview / simIBaseRef.current) : 1) * greenPreviewRatio * valveRatio(selected.data.id)}
                />
                {/* 调节阀控制(动手型交互):拖动即时预览横截面,松手防抖后重跑仿真;仅圆形截面管道可调(后端仅注入 CIRCULAR) */}
                {(!selected.data.shape || String(selected.data.shape).toUpperCase() === "CIRCULAR") && <div className="mt-1.5 rounded bg-purple-950/40 border border-purple-900/60 p-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-purple-300">🚰 调节阀</span>
                    {(valves[selected.data.id] != null || valveDraft[selected.data.id] != null) && <button onClick={() => resetValves(selected.data.id)} className="text-[9px] text-purple-400 hover:text-purple-200">重置</button>}
                  </div>
                  <input type="range" min="0" max="100" step="5" value={Math.round((valveDraft[selected.data.id] ?? valves[selected.data.id] ?? 1) * 100)} onChange={e => onValveChange(selected.data.id, Number(e.target.value))} className="w-full accent-purple-500" />
                  <div className="flex justify-between text-[9px] text-gray-500"><span>关闭</span><span className="text-purple-300 font-bold">{Math.round((valveDraft[selected.data.id] ?? valves[selected.data.id] ?? 1) * 100)}%</span><span>全开</span></div>
                  {(valves[selected.data.id] != null && valveDraft[selected.data.id] == null) && <div className="text-[9px] leading-3 text-purple-400/80 mt-0.5">已生效,拖动调整后松手重新仿真</div>}
                </div>}
                <div className="flex gap-1 mt-1">
                  <button onClick={() => setZoomPipeId(selected.data.id)} className="flex-1 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[10px] font-bold text-gray-300">🔍 放大</button>
                  <button onClick={() => setZoomPipeId(selected.data.id)} title="放大后可下载 PNG 截图" className="flex-1 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[10px] font-bold text-gray-300">📷 截图</button>
                </div>
              </>)}
            </div>
          )}
        </div>
      )}

      {/* ── Time-series charts (dynamic + selected object) ── */}
      {mode === "dynamic" && dynRes?.ok && timeStepCount > 0 && selected && (
        <ChartPanel
          selected={selected}
          dynRes={dynRes}
          dynStep={dynStep}
          timeStepCount={timeStepCount}
          currentTimeLabel={currentTimeLabel}
          onSeek={(step) => { setDynStep(step); setDynPlay(false); setDynPhase("paused"); }}
        />
      )}

      {/* ── Timeline (dynamic only) ── */}
      {/* 方案切换结果状态条 */}
      {schemeMsg && mode === "dynamic" && (
        <div className={`absolute bottom-14 left-1/2 -translate-x-1/2 z-10 bg-black/85 border border-gray-700 rounded-lg px-3 py-1.5 text-[11px] font-bold whitespace-nowrap shadow-lg ${schemeMsg.color}`}>{schemeMsg.text}</div>
      )}
      {/* 3D 主窗口降雨曲线浮层(docx:主窗口展示降雨情景的降雨曲线,当前时刻标记同步) */}
      {mode === "dynamic" && dynRes?.ok && (() => { const s = scnOf(scn); if (!s) return null; return (
        <div className="absolute left-3 top-16 z-10 w-[220px] bg-black/80 border border-gray-700 rounded-lg px-2 py-1.5 pointer-events-none">
          <div className="flex justify-between text-[9px] mb-0.5"><span className="text-cyan-400 font-bold">🌧 {s.label} 降雨曲线</span><span className="text-gray-500">峰值 {s.peakIntensity.toFixed(1)} mm/h</span></div>
          <svg viewBox="0 0 200 44" className="w-full rounded bg-blue-950/30 border border-blue-900/50" preserveAspectRatio="none">
            <polyline points={tsToPoints(s.ts, 200, 44)} fill="none" stroke="#38bdf8" strokeWidth="1.5" />
            <line x1="0" y1="40" x2="200" y2="40" stroke="#334155" strokeWidth="0.5" />
            {timeStepCount > 1 && <line x1={(dynStep / (timeStepCount - 1)) * 200} y1="2" x2={(dynStep / (timeStepCount - 1)) * 200} y2="40" stroke="#ffd54f" strokeWidth="1" strokeDasharray="3 2" />}
          </svg>
          <div className="flex justify-between text-[8px] text-gray-500"><span>0:00</span><span className="text-yellow-400/80">{currentTimeLabel}</span><span>23:55</span></div>
        </div>
      ); })()}
      {/* 分步新手引导卡片 */}
      {guide > 0 && mode === "dynamic" && (
        <div className="absolute left-2 bottom-28 z-20 bg-cyan-950/95 border border-cyan-600 rounded-lg px-3 py-2 text-[11px] text-cyan-100 max-w-[260px] shadow-xl">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold text-cyan-300">🎓 新手引导 {guide}/3</span>
            <button onClick={finishGuide} className="text-[10px] text-cyan-300/70 hover:text-white">跳过 ✕</button>
          </div>
          <div className="leading-4">
            {guide === 1 && <>① <b>点击任意管道</b>,查看管网横截面水量</>}
            {guide === 2 && <>② <b>切换下垫面方案</b>(🟢绿色海绵/🟠灰色),对比水量变化</>}
            {guide === 3 && <>③ <b>选择降雨情景</b>(5/10/50/100 年一遇),观察推演结果</>}
          </div>
          <div className="mt-1.5 text-[9px] text-cyan-300/60">{guide === 1 ? "试试点击场景中的管道 →" : guide === 2 ? "试试点右侧方案按钮 →" : "试试切换右侧降雨情景 →"}</div>
        </div>
      )}
      {/* 渲染图例:水深/风险模式时显示于三维窗口角落,默认/流量模式不显示 */}
      {mode === "dynamic" && (renderMode === "depth" || renderMode === "risk") && (
        <div className="absolute right-3 bottom-4 z-10 bg-black/80 border border-gray-700 rounded-lg px-2.5 py-2 text-[10px] pointer-events-none">
          <div className="font-bold text-gray-300 mb-1.5">{renderMode === "risk" ? "风险" : "水深"}</div>
          {renderMode === "risk"
            ? (
              <>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#ffe14d" }} /><span className="text-gray-400">低</span></div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#fb923c" }} /><span className="text-gray-400">中</span></div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#ef4444" }} /><span className="text-gray-400">高·严重</span></div>
                </div>
                <div className="mt-1.5 w-44 border-t border-gray-700 pt-1 text-[8px] leading-3 text-gray-500">风险按节点水深相对最大值与管道满管率呈现：越大越接近红色(黄=较轻,红=严重)。</div>
              </>
            )
            : (
              <div className="space-y-0.5">
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#38bdf8" }} /><span className="text-gray-400">低</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#a3e635" }} /><span className="text-gray-400">中</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: "#ef4444" }} /><span className="text-gray-400">高</span></div>
              </div>
            )}
        </div>
      )}
      {/* 悬停 tooltip(位置由原生 mousemove 直改 style,内容变化才重渲染) */}
      <div ref={tooltipRef} className={`pointer-events-none fixed z-30 bg-black/85 border border-gray-600 rounded-md px-2 py-1 text-[10px] leading-4 text-gray-200 shadow-lg ${hoverInfo ? "" : "hidden"}`} style={{ display: hoverInfo ? undefined : "none" }}>
        {hoverInfo?.lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
      {/* 首次进入引导气泡 */}
      {showTip && mode === "dynamic" && (
        <div className="absolute left-2 top-14 z-10 bg-cyan-950/90 border border-cyan-700 rounded-lg px-3 py-2 text-[11px] text-cyan-100 max-w-xs shadow-lg">
          💡 <b>互动提示:</b>点击管道查看横截面 · 切换下垫面方案对比水量 · 选择降雨情景后开始推演
          <button onClick={() => setShowTip(false)} className="absolute -top-1.5 -right-1.5 bg-gray-700 hover:bg-gray-600 rounded-full w-4 h-4 text-[9px] leading-4 text-center">✕</button>
        </div>
      )}
      {mode === "dynamic" && dynRes?.ok && (dynPhase === "running" || dynPhase === "paused" || dynPhase === "done" || dynPhase === "ready") && timeStepCount > 0 && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/92 backdrop-blur border-t border-gray-800 px-4 py-2 z-10">
          {/* 降雨过程条:真实降雨曲线概览 + 当前时刻 + 峰值降雨标记(拖动时间轴/推演同步) */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] text-cyan-500 font-bold w-14">🌧 降雨</span>
            <svg className="flex-1 h-5" viewBox="0 0 100 20" preserveAspectRatio="none">
              {/* 峰值降雨标记(真实 peakTime 位置) */}
              {scnOf(scn) && (() => { const s = scnOf(scn)!; const toX = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (((h * 60 + m) / (24 * 60)) * 100); }; const px = toX(s.peakTime); return (
                <>
                  <line x1={px} y1="4" x2={px} y2="7" stroke="#fb7185" strokeWidth="1.2" />
                  <text x={px} y="3" fill="#fb7185" fontSize="3.2" textAnchor="middle">▲ 峰值 {s.peakTime}</text>
                </>
              ); })()}
              <line x1="0" y1="12" x2="100" y2="12" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.7" />
              <circle cx={timeStepCount > 1 ? (dynStep / (timeStepCount - 1)) * 100 : 50} cy="12" r="3" fill="#ffd54f" stroke="#1e293b" strokeWidth="0.8" />
            </svg>
            <span className="text-[9px] text-gray-400 min-w-[3.5rem] text-right">{scnOf(scn)?.label || ""}</span>
          </div>
          {/* 风险统计(满管/溢流)——来自真实结果 */}
          {riskStats && (riskStats.fullPipes.length > 0 || riskStats.overflowNodes.length > 0) && (
            <div className="flex items-center gap-2 mb-1.5 rounded bg-red-950/40 border border-red-900/50 px-2 py-1 text-[9px]">
              <span className="text-red-400 font-bold">⚠️ 风险</span>
              {riskStats.fullPipes.length > 0 && <span className="text-red-300">满管管道 {riskStats.fullPipes.length} 条·{riskStats.fullPipes.slice(0, 4).join(", ")}{riskStats.fullPipes.length > 4 ? "…" : ""}</span>}
              {riskStats.overflowNodes.length > 0 && <span className="text-red-300">溢流节点 {riskStats.overflowNodes.length} 个·{riskStats.overflowNodes.slice(0, 4).join(", ")}{riskStats.overflowNodes.length > 4 ? "…" : ""}</span>}
            </div>
          )}
          {/* 底部结果区:选中管道横截面(随时间轴变化) + 关键指标 */}
          <div className="flex items-center gap-3 mb-1.5 rounded bg-gray-900/60 border border-gray-800 px-2 py-1.5">
            <span className="text-[9px] text-gray-400 shrink-0">🛢 管道横截面</span>
            {(() => {
              const pid = (selected?.type === "pipe" ? selected.data.id : null) || topPipes[0]?.id;
              const ld = (dynRes.links as any)?.[pid];
              const pp = (dataRef.current?.pipes as any)?.find?.((p: any) => p.id === pid);
              if (!ld || !pp) return <div className="text-[10px] text-gray-500">推演后点击任意管道查看横截面</div>;
              const frac = (ld.depthFraction?.[dynStep] ?? 0) * 100;
              return (
                <>
                  <div className="w-24 h-14 shrink-0"><PipeCrossSection compact diam={pp?.diam || 0.3} depth={ld.depth?.[dynStep] ?? 0} depthFraction={ld.depthFraction?.[dynStep] ?? 0} flow={ld.flow?.[dynStep] ?? 0} flowDir={ld.flowDir?.[dynStep] ?? 0} landcover={landcover} animate={false} size="md" /></div>
                  <div className="text-[9px] text-gray-400 truncate max-w-[140px]">{pid} · {frac.toFixed(0)}% 满管 {frac >= 100 ? "⚠️" : ""}</div>
                </>
              );
            })()}
            <div className="ml-auto grid grid-cols-4 gap-2 shrink-0 text-center">
              <div className="rounded bg-gray-950/70 border border-gray-800 px-2 py-1 cursor-pointer hover:bg-gray-900" title={`点击定位 ${dynRes.summary?.maxDepth?.nodeId ?? ""} · 跳到 ${fmtTime(dynRes.summary?.maxDepth?.timestamp ?? 0)}`} onClick={() => { const h = dynRes.summary?.maxDepth?.timestamp; const ta = dynRes.timestamps; if (ta && h != null) { let best = 0, bd = 1e9; ta.forEach((t: number, i: number) => { const d = Math.abs(t - h); if (d < bd) { bd = d; best = i; } }); setDynStep(best); if (dynPlay) setDynPlay(false); } jumpToObject(dynRes.summary?.maxDepth?.nodeId, "node"); }}>
                <div className="text-[8px] text-gray-500">最大水深</div>
                <div className="text-[11px] font-bold text-cyan-300">{(dynRes.summary?.maxDepth?.value ?? 0).toFixed(2)} m</div>
                {dynRes.summary?.maxDepth?.nodeId && <div className="text-[7px] text-cyan-500/80 leading-3">{dynRes.summary.maxDepth.nodeId} · {fmtTime(dynRes.summary.maxDepth.timestamp ?? 0)}</div>}
              </div>
              <div className="rounded bg-gray-950/70 border border-gray-800 px-2 py-1 cursor-pointer hover:bg-gray-900" title={`点击定位 ${dynRes.summary?.maxFlow?.linkId ?? ""} · 跳到 ${fmtTime(dynRes.summary?.maxFlow?.timestamp ?? 0)}`} onClick={() => { const h = dynRes.summary?.maxFlow?.timestamp; const ta = dynRes.timestamps; if (ta && h != null) { let best = 0, bd = 1e9; ta.forEach((t: number, i: number) => { const d = Math.abs(t - h); if (d < bd) { bd = d; best = i; } }); setDynStep(best); if (dynPlay) setDynPlay(false); } jumpToObject(dynRes.summary?.maxFlow?.linkId, "pipe"); const pid = dynRes.summary?.maxFlow?.linkId; if (pid) setZoomPipeId(pid); }}>
                <div className="text-[8px] text-gray-500">最大流量</div>
                <div className="text-[11px] font-bold text-sky-300">{(dynRes.summary?.maxFlow?.value ?? 0).toFixed(2)} m³/s</div>
                {dynRes.summary?.maxFlow?.linkId && <div className="text-[7px] text-sky-500/80 leading-3">{dynRes.summary.maxFlow.linkId}{dynRes.summary.maxFlow.direction ? ` · ${dynRes.summary.maxFlow.direction}` : ""}</div>}
              </div>
              <div className="rounded bg-gray-950/70 border border-gray-800 px-2 py-1">
                <div className="text-[8px] text-gray-500">降雨时长</div>
                <div className="text-[11px] font-bold text-blue-300">{fmtTime(((dynRes.timestamps?.[dynRes.timestamps.length - 1]) as number) ?? 2)}</div>
                <div className="text-[7px] text-blue-500/80 leading-3">总时长</div>
              </div>
              <div className="rounded bg-gray-950/70 border border-gray-800 px-2 py-1">
                <div className="text-[8px] text-gray-500">峰值降雨</div>
                <div className="text-[11px] font-bold text-cyan-300">{(scnOf(scn)?.peakIntensity ?? 0).toFixed(1)} mm/h</div>
                <div className="text-[7px] text-cyan-500/80 leading-3">{scnOf(scn)?.label || ""}</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 font-mono w-12 text-right">{currentTimeLabel}</span>
            <input type="range" min={0} max={timeStepCount-1} value={dynStep} onChange={e => { setDynStep(+e.target.value); if(dynPlay){setDynPlay(false);setDynPhase("paused");} }} title="拖动查看任意时刻" className="flex-1 h-2 appearance-none bg-gray-800 rounded-full cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-cyan-600 [&::-webkit-slider-thumb]:rounded-full" />
            <select value={dynSpd} onChange={e=>setDynSpd(+e.target.value)} className="bg-gray-800 rounded px-1.5 py-1 text-[10px] border border-gray-700 text-gray-400"><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={5}>5×</option></select>
            {dynPhase==="running"
              ? <button title="暂停" onClick={()=>{setDynPlay(false);setDynPhase("paused");}} className="bg-yellow-800 hover:bg-yellow-700 px-2 py-1 rounded text-xs font-bold">⏸</button>
              : <button title="从当前时刻继续播放" onClick={()=>{if(dynStep>=timeStepCount-1)setDynStep(0);setDynPlay(true);setDynPhase("running");}} className="bg-green-800 hover:bg-green-700 px-2 py-1 rounded text-xs font-bold">▶</button>}
            <span className="text-[9px] text-gray-500 font-mono">{fmtTime(((dynRes.timestamps?.[dynRes.timestamps.length-1]) as number) ?? 0)}</span>
          </div>
        </div>
      )}

      {!loaded && !error && <div className="absolute inset-0 flex items-center justify-center bg-gray-950 text-white z-20"><span className="animate-spin mr-2">⏳</span>加载 SWMM 模型…</div>}
      {error && <div className="absolute inset-0 flex items-center justify-center bg-gray-950 text-white z-20"><div className="text-center bg-red-900/60 rounded-xl p-6 max-w-md"><div className="text-2xl mb-2">⚠️</div><div className="text-sm mb-1">{error}</div><button onClick={()=>window.location.reload()} className="mt-3 px-4 py-1.5 bg-red-800 rounded text-xs hover:bg-red-700">刷新页面</button></div></div>}
    </div>
  );
}
