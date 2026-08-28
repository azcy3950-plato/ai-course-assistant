"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { getAuthToken } from "@/contexts/AppContext";
import { parseInp, type Node3D, type Pipe3D, type SC3D } from "@/lib/inp-parser";
import * as THREE from "three";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, MarkPointComponent, MarkLineComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer, MarkPointComponent, MarkLineComponent]);

// ═══════════════════════════════════════════════════════════
// VISUAL CONSTANTS — professional muted palette, no neon
// ═══════════════════════════════════════════════════════════
function scColor(imperv: number): string {
  if (imperv > 80) return "#c09088";
  if (imperv > 40) return "#b0a898";
  return "#8fa890";
}
const PIPE_COLOR      = "#6f8aa0";
const PIPE_EMISSIVE   = "#0a1118";
const NODE_COLOR      = "#6a829c";
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
  if (key === "area") return v.toFixed(3) + " ha"; // INP [SUBCATCHMENTS] Area 结在 ha(如 0.029),直接显示
  if (key === "imperv") return v.toFixed(0) + " %";
  if (key === "slope") return v.toFixed(2) + " %"; // INP %Slope 已是百分比(如 1.39),不再 ×100
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
import { RAIN_SCENARIOS, type RainfallScenarioKey } from "./rainfall-scenarios";
// 选中情景 → 对象(按 key)
function scnOf(key?: string) {
  return RAIN_SCENARIOS.find(s => s.key === key);
}
// LID 优化策略的设施组成比例(GR绿色屋顶/VS植草沟/RG雨水花园/PP透水铺装)与说明
// 与后端 LID_STRATEGIES 保持一致;比例=设施组合内部构成,非区域土地覆盖
export type LidStrategyKey = "balanced" | "runoff" | "waterquality" | "ecological";
export const LID_STRATEGY_MAP: Record<LidStrategyKey, { label: string; GR: number; VS: number; RG: number; PP: number }> = {
  balanced:     { label: "均衡型", GR: 6.28,  VS: 7.12,  RG: 7.12,  PP: 79.48 },
  runoff:       { label: "径流削减型", GR: 3.03, VS: 8.59, RG: 2.15, PP: 86.24 },
  waterquality: { label: "水质控制型", GR: 2.76, VS: 11.31, RG: 4.35, PP: 81.57 },
  ecological:   { label: "生态服务型", GR: 12.20, VS: 6.92, RG: 34.58, PP: 46.31 },
};
export const LID_STRATEGY_DESC: Record<LidStrategyKey, string> = {
  balanced: "综合平衡径流控制、水质改善与生态效益。",
  runoff: "强化雨洪调蓄与径流峰值削减。",
  waterquality: "侧重面源污染控制与污染负荷削减。",
  ecological: "突出绿化、降温与生态系统服务效益。",
};

// 动态沙盘专属数据状态：污染物来自当前 INP 配置；接口暂未返回其时序与负荷结果。
const WATER_QUALITY_INDICATORS = ["COD", "TN", "TP"] as const;
const ECO_SERVICE_INDICATORS = [
  { label: "碳减排量", unit: "kg CO₂e", source: "生态效益模型" },
  { label: "地表降温效果", unit: "℃", source: "热环境模型" },
  { label: "雨水资源利用量", unit: "m³", source: "雨水利用模块" },
  { label: "绿地与生态效益提升", unit: "%", source: "生态系统服务评价" },
] as const;

// 统一运行负荷分级阈值与状态判定(展示分级,非工程风险评级):供 3D 着色、右侧统计、横截面标签、异常事件共用同一套。
// 五档:normal 正常 <0.50 / medium 中等负荷 0.50–0.80 / high 高负荷 0.80–0.95 / nearFull 接近满管 0.95–1.00 / full 满管 ≥1.00。
const RUN_LOAD = { medium: 0.5, high: 0.8, nearFull: 0.95, full: 1.0 } as const;
// 唯一负荷状态判定入口(其余模块不得各自判断阈值)
function getPipeLoadState(depthFraction: number): "normal" | "medium" | "high" | "nearFull" | "full" {
  const v = depthFraction ?? 0;
  if (v >= RUN_LOAD.full) return "full";
  if (v >= RUN_LOAD.nearFull) return "nearFull";
  if (v >= RUN_LOAD.high) return "high";
  if (v >= RUN_LOAD.medium) return "medium";
  return "normal";
}
function pipeLoadLabel(depthFraction: number): string {
  const map: Record<string, string> = { normal: "正常", medium: "中等负荷", high: "高负荷", nearFull: "接近满管", full: "满管" };
  return map[getPipeLoadState(depthFraction)];
}

type HydroMetrics = {
  runoffSeries: number[];
  cumulativeOutflow: number | null;
  peakOutflow: number | null;
  peakTime: number | null;
  maxDepth: number | null;
  pondedNodes: number;
  highLoadPipes: number;
};

// 仅从 SWMM 已返回的节点/管段时序派生，不创建演示数值。
function deriveHydroMetrics(result: any, model: any): HydroMetrics | null {
  if (!result?.timestamps?.length || !result?.links || !result?.nodes || !model) return null;
  const timestamps = result.timestamps as number[];
  const outfalls = new Set((model.nodes || []).filter((n: any) => n.type === "outfall").map((n: any) => n.id));
  const outletPipes = (model.pipes || []).filter((p: any) => outfalls.has(p.to) || outfalls.has(p.from));
  const hasOutletData = outletPipes.some((p: any) => Array.isArray(result.links?.[p.id]?.flow));
  const runoffSeries = hasOutletData ? timestamps.map((_: number, idx: number) => outletPipes.reduce((sum: number, p: any) => {
    const flow = Number(result.links?.[p.id]?.flow?.[idx] ?? 0);
    if (outfalls.has(p.to)) return sum + Math.max(0, flow);
    return sum + Math.max(0, -flow);
  }, 0)) : [];
  let cumulativeOutflow: number | null = hasOutletData ? 0 : null;
  if (cumulativeOutflow != null) {
    for (let i = 1; i < runoffSeries.length; i++) {
      const seconds = Math.max(0, (timestamps[i] - timestamps[i - 1]) * 3600);
      cumulativeOutflow += ((runoffSeries[i - 1] + runoffSeries[i]) / 2) * seconds;
    }
  }
  let peakOutflow: number | null = null, peakTime: number | null = null;
  if (runoffSeries.length) {
    let peakIdx = 0;
    for (let i = 1; i < runoffSeries.length; i++) if (runoffSeries[i] > runoffSeries[peakIdx]) peakIdx = i;
    peakOutflow = runoffSeries[peakIdx];
    peakTime = timestamps[peakIdx] ?? null;
  }
  let pondedNodes = 0, highLoadPipes = 0;
  for (const node of Object.values(result.nodes) as any[]) {
    if (Array.isArray(node?.pondedVolume) && node.pondedVolume.some((v: number) => v > 0.01)) pondedNodes++;
  }
  for (const link of Object.values(result.links) as any[]) {
    if (Array.isArray(link?.depthFraction) && link.depthFraction.some((v: number) => v >= RUN_LOAD.high)) highLoadPipes++;
  }
  const maxDepthValue = result.summary?.maxDepth?.value;
  return {
    runoffSeries,
    cumulativeOutflow,
    peakOutflow,
    peakTime,
    maxDepth: Number.isFinite(maxDepthValue) ? Number(maxDepthValue) : null,
    pondedNodes,
    highLoadPipes,
  };
}

function reductionLabel(baseline: number | null, optimized: number | null): string {
  if (baseline == null || optimized == null) return "待计算";
  if (Math.abs(baseline) < 1e-9) return Math.abs(optimized) < 1e-9 ? "无变化" : "现状值为 0";
  const value = ((baseline - optimized) / Math.abs(baseline)) * 100;
  if (Math.abs(value) < 0.05) return "无明显变化";
  return value > 0 ? `↓${Math.abs(value).toFixed(1)}%` : `↑${Math.abs(value).toFixed(1)}%`;
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

function PipeCrossSection({ diam, depth, depthFraction, flow, flowDir, landcover, previewRatio = 1, animate = true, compact = false, largeLabels = false, size = "md", onCanvas }: {
  diam: number; depth: number; depthFraction: number; flow: number; flowDir: string; landcover: string; previewRatio?: number; animate?: boolean; compact?: boolean; largeLabels?: boolean; size?: "md" | "lg"; onCanvas?: (c: HTMLCanvasElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ diam, depth, depthFraction, flow, flowDir, previewRatio, compact, largeLabels, size });
  latest.current = { diam, depth, depthFraction, flow, flowDir, previewRatio, compact, largeLabels, size };
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
        const st = getPipeLoadState(fillRatio); const isFull = st === "nearFull" || st === "full";
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
      ctx.font = L.compact ? `${L.largeLabels ? 10 : 8}px monospace` : `${L.largeLabels ? 11 : 9}px monospace`;
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
  }, [animate, diam, depth, depthFraction, flow, previewRatio, largeLabels]);

  return (
    <div className={`rounded-lg border border-gray-700 bg-black/80 ${latest.current.compact ? "p-0.5" : "p-1.5"}`}>
      {!latest.current.compact && (
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-[10px] font-bold text-gray-300">🔵 管道横截面</span>
          <span className="text-[9px] text-gray-500">{landcover === "green" ? "🟢 海绵优化" : "⚪ 现状基准"}</span>
        </div>
      )}
      <canvas ref={canvasRef} className="block" />
      {!latest.current.compact && <div className="px-1 pt-1 text-[9px] leading-4 text-gray-500">{flowDir}</div>}
    </div>
  );
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
  const [staticOverviewOpen, setStaticOverviewOpen] = useState(true);
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
  // 现有海绵优化接口使用完整配置强度；页面不再保留无入口的旧调节状态。
  const greenLevel = 1;
  // 模拟方案:现状基准 baseline | 海绵优化 optimize(+LID 策略)；landcover 收敛为两态(高开发已移除)
  const [landcover, setLandcover] = useState<"default" | "green">("default");
  const [simMode, setSimMode] = useState<"baseline" | "optimize">("baseline");
  const [lidStrategy, setLidStrategy] = useState<LidStrategyKey>("balanced");
  const [activePollutant, setActivePollutant] = useState<(typeof WATER_QUALITY_INDICATORS)[number]>("COD");
  // 雨强预览:拖动滑条时即时缩放横截面水位,松手防抖后真实仿真覆盖
  const [rainPreview, setRainPreview] = useState<number | null>(null);
  const simIBaseRef = useRef(100); // 当前已仿真结果对应的强度
  const rainTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 切方案变化高亮与提示:上一次仿真结果(不同方案/强度)用于计算 Δ
  const prevSimRef = useRef<any>(null);
  // 现状基准结果缓存(键=降雨情景 series):海绵优化运行后与基线对比;缓存键含 series 且绑定当前 INP 模型(重启即失效)
  const baselineCacheRef = useRef<Record<string, any>>({});
  // 方案对比缓存:以降雨情景+input版本分组,存各方案(现状/均衡/径流/水质/生态)的 summary(真实 SWMM 结果)
  const comparisonCacheRef = useRef<Record<string, Record<string, any>>>({});
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
  // 本次推演的实际参数(mode/lidStrategy/rainfall),结果标签必须绑定它,避免切按钮改旧结果标题
  const [resultScenario, setResultScenario] = useState<{ mode: string; lidStrategy: string | null; rainfall: string | null }>({ mode: "baseline", lidStrategy: null, rainfall: null });
  // 分步新手引导:1 点击管道 → 2 切换方案 → 3 拖动雨强滑条(每步完成自动下一步,可跳过)
  const [guide, setGuide] = useState(0);
  // 悬停提示:内容变化才 setState(位置由原生事件直接改 style,避免高频重渲染)
  const [hoverInfo, setHoverInfo] = useState<{ lines: string[]; type: string } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [dynRes, setDynRes] = useState<any>(null);
  // LID 真实空间重分配应用状态:仅在 lidRedist.applied===true 时,才允许显示「现状 vs 海绵优化」结果对比
  const [lidRedistApplied, setLidRedistApplied] = useState(false);
  const [dynStep, setDynStep] = useState(0);
  const [dynPlay, setDynPlay] = useState(false);
  const [dynSpd, setDynSpd] = useState(1);
  const [dynPhase, setDynPhase] = useState<"config"|"loading"|"ready"|"running"|"paused"|"done">("config");
  const [runStage, setRunStage] = useState<"idle"|"baseline"|"optimize">("idle");
  // 推演等待计时(秒,loading 阶段递增;仅展示已等待时间,非伪造进度)
  const [loadingSec, setLoadingSec] = useState(0);
  useEffect(() => {
    if (dynPhase === "loading") {
      setLoadingSec(0);
      const iv = setInterval(() => setLoadingSec(s => + (s + 0.1).toFixed(1)), 100);
      return () => clearInterval(iv);
    }
    setLoadingSec(0);
  }, [dynPhase]);
  // 系统自动表现:静态=结构视图;动态推演(有结果)=自动显示水深圆盘+管道流量着色+下垫面弱化
  const showingResults = mode === "dynamic" && !!dynRes;
  const [openBar, setOpenBar] = useState<"view" | "layer" | null>(null);
  const [curView, setCurView] = useState<"panorama" | "topdown" | "underground">("panorama");
  // 事件记录默认收起，避免长期占据沙盘视野。
  const [showEvents, setShowEvents] = useState(false);
  // ── 可调布局(#29):底部诊断台高度 / 右侧栏宽度 / 各自的收起状态 / 拖拽进行中 ──
  const [bottomH, setBottomH] = useState(240);
  const [rightW, setRightW] = useState(284);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const dragRef = useRef<{ axis: "h" | "v"; orig: number; start: number } | null>(null);
  const resetLayout = useCallback(() => { setBottomH(240); setRightW(284); setBottomCollapsed(false); setRightCollapsed(false); }, []);
  // 拖拽分隔条:鼠标移动更新面板尺寸,bottom/right 面板 absolute 覆盖,3D 露出区域随尺寸增减(视觉 3D 变大缩小)
  useEffect(() => {
    const mv = (e: PointerEvent) => { const d = dragRef.current; if (!d) return; e.preventDefault(); if (d.axis === "h") setBottomH(Math.max(150, Math.min(380, d.orig + (d.start - e.clientY)))); else setRightW(Math.max(220, Math.min(420, d.orig + (e.clientX - d.start)))); };
    const up = () => { dragRef.current = null; };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
  }, []);
  const [theme, setTheme] = useState<"dark" | "light">(() => { try { return localStorage.getItem("sandbox-theme") === "light" ? "light" : "dark"; } catch { return "dark"; } });
  // 静态与动态沙盘统一使用站点的浅色工作台背景。
  const applyTheme = useCallback(() => {
    const sc = sceneRef.current; if (!sc) return;
    const sceneBackground = "#edf3f9";
    (sc.background as THREE.Color)?.set(sceneBackground);
    (sc.fog as THREE.Fog)?.color?.set(sceneBackground);
    const gm = gridRef.current?.material as THREE.LineBasicMaterial | undefined;
    if (gm) gm.color.set("#b9c7d6");
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
      const initialSceneBackground = "#edf3f9";
      scene.background = new THREE.Color(initialSceneBackground);
      scene.fog = new THREE.Fog(initialSceneBackground, 300, 1200);
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
      camState.current = { theta: 0.45, phi: 0.8, dist: span * 0.72, tx: cx, tz: cz };

      const updateCam = () => {
        const cs = camState.current;
        camera.position.x = cs.tx + cs.dist * Math.sin(cs.phi) * Math.cos(cs.theta);
        camera.position.y = Math.max(0.8, cs.dist * Math.cos(cs.phi) * 0.65);
        camera.position.z = cs.tz + cs.dist * Math.sin(cs.phi) * Math.sin(cs.theta);
        camera.lookAt(cs.tx, cs.dist * 0.04, cs.tz);
      };
      updateCam();
      setLoaded(true);

      // Mouse controls
      let dragging = false, last = { x: 0, y: 0 };
      renderer.domElement.addEventListener("mousedown", e => { if (e.button <= 1) { dragging = true; last = { x: e.clientX, y: e.clientY }; } });
      renderer.domElement.addEventListener("mousemove", e => { if (!dragging) return; camState.current.theta -= (e.clientX - last.x) * 0.005; camState.current.phi = Math.max(0.15, Math.min(1.15, camState.current.phi - (e.clientY - last.y) * 0.005)); last = { x: e.clientX, y: e.clientY }; updateCam(); });
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
      // 最近对象回退:点击未命中精确 mesh 时,选屏幕距离最近的可交互管网对象(容差 ~30px),保证"点到即选中"
      const pickNearest = (nx: number, ny: number, maxPx: number): any => {
        const box = new THREE.Box3(), vp = new THREE.Vector3();
        let best: any = null, bestPx = maxPx;
        const visit = (o: THREE.Object3D) => {
          const t = (o as any).userData?.type;
          if (t === "pipe" || t === "node" || (o as any).userData?.storage) {
            try {
              const g = (o as THREE.Mesh).geometry as any;
              if (g && g.boundingBox) g.boundingBox.getCenter(vp);
              else if (g) { g.computeBoundingBox(); g.boundingBox.getCenter(vp); }
              else o.getWorldPosition(vp);
            } catch { o.getWorldPosition(vp); }
            vp.project(camera);
            const dx = (vp.x - nx) * 0.5 * (renderer.domElement.clientWidth || 1);
            const dy = (vp.y - ny) * 0.5 * (renderer.domElement.clientHeight || 1);
            const pxd = Math.hypot(dx, dy);
            if (pxd < bestPx) { bestPx = pxd; best = o; }
          }
          if (o.children) for (const c of o.children) visit(c);
        };
        for (const c of scene.children) visit(c);
        return best;
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
        let obj = pick(nx, ny);
        if (!obj) obj = pickNearest(nx, ny, 90);
        if (obj) {
          if (selRef.current !== obj) { if (selRef.current) resetHL(selRef.current); selRef.current = obj; hlObj(obj); setSelected({ type: obj.userData.type, data: obj.userData.data }); }
          setRightCollapsed(false); // 命中后展开右栏,确保选中详情/横截面可见
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
        const _nx = ((e.clientX - rect.left) / rect.width) * 2 - 1, _ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const obj = pick(_nx, _ny) || pickNearest(_nx, _ny, 28);
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
        renderer.render(scene, camera);
      };
      animate();
      const onResize = () => { const w2 = cr.current!.clientWidth, h2 = cr.current!.clientHeight; camera.aspect = w2 / h2; camera.updateProjectionMatrix(); renderer.setSize(w2, h2); };
      window.addEventListener("resize", onResize);
      return () => { window.removeEventListener("resize", onResize); cancelAnimationFrame(rafId); renderer.dispose(); };
    } catch (e: any) { setError(e.message); }
  })(); }, []);

  // 三栏布局会改变地图容器尺寸，但不会触发 window.resize。
  // 仅同步画布与相机尺寸，保持既有 Three.js 场景与推演逻辑不变。
  useEffect(() => {
    const host = cr.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      const width = Math.max(1, Math.floor(entry.contentRect.width));
      const height = Math.max(1, Math.floor(entry.contentRect.height));
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      if (!camera || !renderer) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  function hlObj(obj: THREE.Object3D) {
    obj.traverse(c => { if (c instanceof THREE.Mesh && c.material && !(c.material as any)._isWater) { (c.material as any).emissive = new THREE.Color(HIGHLIGHT_EMI); (c.material as any).emissiveIntensity = 0.5; } });
  }
  function resetHL(obj: THREE.Object3D) {
    obj.traverse(c => { if (c instanceof THREE.Mesh && c.material && !(c.material as any)._isWater) { (c.material as any).emissive = new THREE.Color("#000000"); (c.material as any).emissiveIntensity = 0; } });
  }

  // 指标/事件点击定位：选中对象、跳转到对应时刻并聚焦相机。
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
    // 综合 node 与所有汇水区多边形范围,确保 ground 覆盖完整项目(避免 SC 伸出底面)
    data.nodes.forEach((n: Node3D) => { if (n.x<mnX) mnX=n.x; if (n.x>mxX) mxX=n.x; if (n.z<mnZ) mnZ=n.z; if (n.z>mxZ) mxZ=n.z; if (n.invert<minElev) minElev=n.invert; if (n.ground>maxElev) maxElev=n.ground; });
    (data.scs as Array<{ pts: Array<[number, number]> }> | undefined)?.forEach(sc => sc.pts.forEach(([x, z]) => { if (x<mnX) mnX=x; if (x>mxX) mxX=x; if (z<mnZ) mnZ=z; if (z>mxZ) mxZ=z; }));

    // 若仍无数据(极端),回退 span=50
    if (!Number.isFinite(mnX) || mnX === Infinity) { mnX = -25; mxX = 25; mnZ = -25; mxZ = 25; }
    const span = Math.max(mxX - mnX, mxZ - mnZ, 50);
    const elevY = (e: number) => (e - minElev) * ve;
    // Ground plane at engineering surface (average of all node ground elevations)
    const avgSurface = data.nodes.reduce((s: number, n: Node3D) => s + n.ground, 0) / data.nodes.length;
    const gndY = elevY(avgSurface);

    // ── Scale parameters (all from span, NOT hardcoded) ──
    const NODE_R    = Math.max(0.2, span * 0.001);
    const OUTFALL_R = NODE_R * 1.5;
    const PIPE_MIN_R = Math.max(0.12, span * 0.0011);
    const PIPE_MAX_R = span * 0.0042;

    // ── Ground (覆盖 node+汇水区综合范围,项目内不悬空,不外扩大矩形板) ──
    // 灰度图地面板:非 TIN,是研究区底板;降低透明度和明度,避免被误认为“巨大灰色悬空面”
    const gndSpan = span * 1.02;
    const groundGeom = new THREE.PlaneGeometry(gndSpan, gndSpan);
    groundGeom.rotateX(-Math.PI / 2);
    const groundMesh = new THREE.Mesh(groundGeom, new THREE.MeshStandardMaterial({ color: "#d8e2ec", roughness: 0.96, transparent: true, opacity: 0.72, depthWrite: true }));
    groundMesh.position.y = gndY; groundMesh.receiveShadow = true; groundMesh.renderOrder = 0;
    groundMesh.userData = { type: "ground" };
    grp.ground.add(groundMesh);

    // 规则网格底板已移除(调试辅助面,正式环境不渲染);仅保留真实 Terrain 与汇水区/管网
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
      const fill = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color, roughness: 0.75, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2; fill.position.y = gndY + 0.04; fill.renderOrder = 1;
      fill.userData = { type: "subcatchment", data: { id: sc.id, area: sc.area, imperv: sc.imperv, outlet: sc.outlet, width: sc.width, slope: sc.slope, vertices: sc.pts.length } };
      grp.sc.add(fill);

      // Thin border
      if (sc.pts.length <= 200) {
        const edgePts = sc.pts.map(([x, z]) => new THREE.Vector3(x, gndY + 0.05, z));
        edgePts.push(edgePts[0].clone());
        const edgeGeom = new THREE.BufferGeometry().setFromPoints(edgePts);
        const edgeLine = new THREE.Line(edgeGeom, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.32, depthTest: true }));
        edgeLine.renderOrder = 2; grp.sc.add(edgeLine);
      }
    });

    // ── Nodes — vertical shafts, proportional ──
    data.nodes.forEach((n: Node3D) => {
      const g = new THREE.Group();
      const invertY = elevY(n.invert), groundY = elevY(n.ground);
      // 节点柱高:压缩 0.55 降低“电线杆”感,保留相对差异;shaft.position 随之调整
      const shaftH = Math.max(0.12, (groundY - invertY) * 0.55);
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
      const visualR = Math.max(PIPE_MIN_R, Math.min(PIPE_MAX_R, p.diam * 0.55));
      const path: THREE.Vector3[] = [new THREE.Vector3(fn.x, fromY, fn.z)];
      p.verts.forEach(([vx, vz]) => path.push(new THREE.Vector3(vx, fromY, vz)));
      path.push(new THREE.Vector3(tn.x, toY, tn.z));
      if (path.length < 2) return;

      const curve = new THREE.CatmullRomCurve3(path);
      const tubeGeom = new THREE.TubeGeometry(curve, Math.max(6, path.length * 3), visualR, 8, false);
      const tube = new THREE.Mesh(tubeGeom, new THREE.MeshStandardMaterial({ color: PIPE_COLOR, roughness: 0.35, metalness: 0.12, emissive: PIPE_EMISSIVE, emissiveIntensity: 0.18 }));
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
      panorama:    { theta: 0.45, phi: 0.8,  dist: span * 0.72, tx: cx, tz: cz },
      topdown:     { theta: 0,    phi: 0.08, dist: span * 0.85, tx: cx, tz: cz },
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
      cameraRef.current.position.set(cs.tx + cs.dist * Math.sin(cs.phi) * Math.cos(cs.theta), Math.max(0.8, cs.dist * Math.cos(cs.phi) * 0.65), cs.tz + cs.dist * Math.sin(cs.phi) * Math.sin(cs.theta));
      cameraRef.current.lookAt(cs.tx, cs.dist * 0.04, cs.tz);
    }
  };

  // ═══════════════════════════════════════════════════════════
  // DYNAMIC MODE — kept from working backend, visuals cleaned
  // ═══════════════════════════════════════════════════════════
  const loadSim = useCallback(async (overrideIntensity?: number, overrideLandcover?: "default" | "green", overrideValves?: Record<string, number>, overrideGreenLevel?: number, overrideLidStrategy?: string | null) => {
    // 唯一有效 LID 策略:baseline(现状基准)必须完全忽略残留的 lidStrategy——
    // 仅当 simMode===“optimize” 才用 lidStrategy;override 显式传入时优先(用于海绵优化重跑)。
    const effectiveLidStrategy = overrideLidStrategy !== undefined
      ? overrideLidStrategy
      : (simMode === "optimize" ? lidStrategy : null);
    // 四个固定策略(balanced/runoff/waterquality/ecological)可真实进入 SWMM,不拦截。
    const reqSeq = ++simSeqRef.current;
    // 取消待执行的雨强/绿色强度防抖重跑(避免旧闭包竞态覆盖新方案状态)
    if (rainTimer.current) { clearTimeout(rainTimer.current); rainTimer.current = null; }
    setRainPreview(null);
    setDynPhase("loading"); setDynStep(0);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const simIntensity = overrideIntensity ?? (scnOf(scn)?.key === scn ? 100 : 80);
    const simLandcover = overrideLandcover ?? landcover;
    // LID 策略:海绵优化走真实 [LID_USAGE] 面积重分配(后端),现状基准/null=不重分配
    const simLidStrategy = effectiveLidStrategy;
    // 开始推演时把调节阀拖动的 draft 合并为正式阀门(预览→生效仅在点开始推演)
    const mergedValves: Record<string, number> = { ...valves };
    for (const [pid, k] of Object.entries(valveDraft)) if (k != null) mergedValves[pid] = k;
    const simValves = overrideValves ?? mergedValves;
    const simGreenLevel = overrideGreenLevel ?? (simLandcover === "green" ? greenLevel : undefined);
    const simSeries = scnOf(scn) ? scn : undefined;
    let tid: ReturnType<typeof setTimeout> | null = null;
    let baselineForRun: any = null;
    const cacheComparisonResult = (series: string | undefined, key: string, result: any) => {
      if (!series || !result?.summary) return;
      const g = (comparisonCacheRef.current[series] = comparisonCacheRef.current[series] || {});
      let maxDF = 0, pondN = 0, highN = 0;
      const links = (result?.links as Record<string, any>) || {};
      const nodes = (result?.nodes as Record<string, any>) || {};
      for (const link of Object.values(links)) {
        const values = link?.depthFraction as number[];
        if (!values?.length) continue;
        let peak = 0;
        for (let i = 0; i < values.length; i++) if (values[i] > peak) peak = values[i];
        if (peak > RUN_LOAD.high) highN++;
        if (peak > maxDF) maxDF = peak;
      }
      for (const node of Object.values(nodes)) {
        const values = node?.pondedVolume as number[];
        if (values?.some(v => v > 0.01)) pondN++;
      }
      g[key] = { summary: result.summary, maxDF, pondN, highN };
    };
    try {
      tid = setTimeout(() => ctrl.abort(), 180000);
      let d: any;
      // 仅开发验收模式(URL 带 ?fixture=1):加载真实 SWMM 历史结果(public/sandbox-fixture.json)驱动动态 UI,不走 /api(不需 token)。
      // 默认(无 fixture=1)完全走正常 /api/swmm 真实推演,此分支不参与任何正式运行。
      if (typeof window !== "undefined" && new URLSearchParams(location.search).get("fixture") === "1") {
        if (simLidStrategy) { setSchemeMsg({ text: "fixture 模式仅支持现状基准，LID 情景不能在此回放。", color: "text-amber-700" }); setDynPhase("config"); return; }
        setRunStage("baseline");
        const fr = await fetch("/sandbox-fixture.json", { signal: ctrl.signal });
        if (!fr.ok) throw new Error("fixture missing");
        d = { ...(await fr.json()), ok: true, simulationId: "fixture-real-swmm", lidRedist: { attempted: false, applied: false, blockedReason: "" } };
      } else {
        const requestSimulation = async (cover: "default" | "green", strategy: string | null, level?: number) => {
          const res = await fetch("/api/swmm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ intensity: simIntensity, series: simSeries, landcover: cover, lidStrategy: strategy || undefined, greenLevel: level, valves: Object.keys(simValves).length ? simValves : undefined }), signal: ctrl.signal });
          if (res.status === 401) throw new Error("需要登录:请用真实账号在浏览器登录后推演");
          const json = await res.json();
          if (!json.ok) throw new Error(json.error || "API error");
          return json;
        };
        // 海绵情景统一先运行同降雨、同阀门条件下的现状基准，再沿用原接口运行所选 LID 情景。
        if (simLidStrategy && simSeries) {
          setRunStage("baseline");
          baselineForRun = await requestSimulation("default", null);
          baselineCacheRef.current[simSeries] = baselineForRun;
          cacheComparisonResult(simSeries, "baseline", baselineForRun);
        }
        setRunStage(simLidStrategy ? "optimize" : "baseline");
        d = await requestSimulation(simLandcover, simLidStrategy, simGreenLevel);
      }
      if (tid) { clearTimeout(tid); tid = null; }
      if (abortRef.current === ctrl) abortRef.current = null;
      if (reqSeq !== simSeqRef.current) return;
      setDynRes(d); setDynPhase("running"); setDynPlay(true); setLidRedistApplied(!!d?.lidRedist?.applied);
      setResultScenario({ mode: simLidStrategy ? "optimize" : "baseline", lidStrategy: simLidStrategy || null, rainfall: simSeries || null });
      // 以 BACKEND response.lidRedist.applied 判断海绵是否真正应用(不前端提前猜)
      if (simLidStrategy && d?.lidRedist?.attempted && !d?.lidRedist?.applied) {
        setSchemeMsg({ text: "当前 LID 情景未成功应用，未生成优化结果。", color: "text-amber-700" });
      }
      cacheComparisonResult(simSeries, simLidStrategy || (simLandcover === "green" ? "optimize" : "baseline"), d);
      // 现状基准结果入缓存:仅当未选 LID 策略(landcover=default 或无 lidStrategy)时缓存,供海绵优化对比
      if (!simLidStrategy && simLandcover !== "green" && simSeries) baselineCacheRef.current[simSeries] = d;
      simIBaseRef.current = simIntensity;
      // 切方案/调雨强后的变化高亮(与上一结果对比)与状态条提示
      const prev = baselineForRun || prevSimRef.current;
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
                // 与着色 effect 同款公式(含满管/接近满管橙分支),恢复不覆盖 effect 语义
                const _st = getPipeLoadState(capacity); const isFull = _st === "nearFull" || _st === "full";
                const ratio = Math.min(1, Math.abs(flow) / maxF);
                mat.color.set(new THREE.Color().setHSL(isFull ? 0.05 : 0.55 - ratio * 0.35, 0.7, 0.4 + ratio * 0.25));
                mat.emissive.set(new THREE.Color().setHSL(isFull ? 0.05 : 0.55 - ratio * 0.35, 0.7, 0.08 + ratio * 0.12));
                mat.emissiveIntensity = isFull ? 0.5 : 0.08 + ratio * 0.4;
              }
            });
          }, 5200);
          const down = top.filter(([, v]) => v < 0).length, up = top.filter(([, v]) => v > 0).length;
          const msg = simLandcover === "green" ? `🟢 海绵优化方案:${down} 条管道水量下降` : `⚪ 现状基准`;
          setSchemeMsg({ text: msg, color: simLandcover === "green" ? "text-emerald-700" : "text-slate-600" });
          if (schemeMsgTimer.current) clearTimeout(schemeMsgTimer.current);
          schemeMsgTimer.current = setTimeout(() => setSchemeMsg(null), 4000);
        }
      }
    } catch (e: any) { if (reqSeq !== simSeqRef.current) return; if (abortRef.current === ctrl) abortRef.current = null; setDynPhase("config"); if (e.name !== "AbortError") alert("仿真加载失败: " + e.message); }
    finally { if (tid) clearTimeout(tid); setRunStage("idle"); }
  }, [scn, landcover, valves, valveDraft, greenLevel, lidStrategy, simMode]);


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
      const previewRatio = rainPreview != null ? Math.max(0.05, rainPreview / simIBaseRef.current) : 1;
      const wh = Math.max(0.03, depth * ve) * previewRatio;
      (wm as any).userData.targetScaleY = wh;
      (wm as any).userData.targetY = invertY + wh / 2;
      const m = wm.material as THREE.MeshStandardMaterial;
      if (ponding > 0.01 || isOverflow) { m.color.set("#e04040"); m.emissive.set("#300000"); m.emissiveIntensity = 0.4; }
      else { const ratio = Math.min(1, depth / (ts.summary?.maxDepth?.value || 1)); m.color.set(new THREE.Color().setHSL(0.57 - ratio * 0.12, 0.7, 0.35 + ratio * 0.2)); m.emissive.set("#001122"); m.emissiveIntensity = 0.15 + ratio * 0.2; }

      // 积水热力圆盘:推演有结果后自动显示(蓝→红随水深),无需用户选模式
      if (showingResults && depth > 0.02) {
        const maxD = ts.summary?.maxDepth?.value || 1;
        const ratio = Math.min(1, depth / Math.max(0.05, maxD));
        const ringGeom = SHARED.heatDisc; // 共享几何
        const hue = 0.62 - ratio * 0.62; // 蓝→红
        const sat = 0.85;
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
      // 推演后管道自动按流量着色(随水流变化);静态/配置阶段统一低饱和蓝灰
      if (!showingResults || absFlow < 0.0005) { mat.color.set(PIPE_COLOR); mat.emissive.set(PIPE_EMISSIVE); mat.emissiveIntensity = 0.08; }
      else {
        const maxF = ts.summary?.maxFlow?.value || 0.1; const ratio = Math.min(1, absFlow / maxF);
        const _st = getPipeLoadState(capacity); const isFull = _st === "nearFull" || _st === "full";
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
  }, [dynStep, dynRes, vertEx, showingResults, selected, rainPreview, valves, valveDraft]);

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
          setSchemeMsg({ text: "选择情景与降雨条件后开始推演；结果区统一对比现状基准与海绵优化。", color: "text-blue-700" });
          if (schemeMsgTimer.current) clearTimeout(schemeMsgTimer.current);
          schemeMsgTimer.current = setTimeout(() => setSchemeMsg(null), 6000);
        }
      } catch { /* 忽略 */ }
    }
  }, [guide]);

  // ─── 管道调节阀:开度预览/防抖生效/重置(与雨强滑条同「预览→重跑」模式) ───
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

  // 下垫面 3D 预览:仅按真实 %Imperv 显示地表属性(baseline/optimize 同一套,不做策略 tint)
  // LID 空间数据冻结:禁止按策略对全图做 hueShift/整图染色;策略差异只通过比例卡/组成条/图例表达,不伪造设施位置
  const applyLandcoverPreview = useCallback(() => {
    const grp = groupsRef.current["sc"]; if (!grp) return;
    const toColor = (orig: number) => {
      if (orig > 80) return "#c09088"; if (orig > 40) return "#b0a898"; return "#8fa890";
    };
    grp.children.forEach(c => {
      const ud = c.userData as any;
      const mat = (c as THREE.Mesh).material as THREE.Material | undefined;
      if (!ud || !mat) return;
      const imperv = ud.data?.imperv;
      if (typeof imperv === "number") (mat as THREE.MeshStandardMaterial | THREE.LineBasicMaterial).color.set(toColor(imperv));
    });
  }, []);
  useEffect(() => { applyLandcoverPreview(); }, [applyLandcoverPreview]);

  // 下垫面弱化:推演有结果后降低汇水区填充到背景层,自动突出积水/流量
  useEffect(() => {
    const grp = groupsRef.current["sc"]; if (!grp) return;
    const weak = mode === "dynamic" && !!dynRes;
    grp.children.forEach(c => {
      const m = c as THREE.Mesh; const mat = m.material as THREE.MeshStandardMaterial | undefined;
      if (mat && typeof mat.opacity === "number" && mat.transparent) mat.opacity = weak ? 0.07 : 0.2;
    });
  }, [mode, dynRes]);

  // 卸载清理防抖/提示定时器(防卸载后 setState/fetch)
  useEffect(() => () => {
    if (rainTimer.current) clearTimeout(rainTimer.current);
    if (schemeMsgTimer.current) clearTimeout(schemeMsgTimer.current);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    if (traceTimerRef.current) clearTimeout(traceTimerRef.current);
    if (valveTimerRef.current) clearTimeout(valveTimerRef.current);
  }, []);

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
          const _st = getPipeLoadState(capacity); const isFull = _st === "nearFull" || _st === "full";
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

  // 代表性管段候选：按全时段峰值流量选取，用户点击管段后由所选管段替代。
  const pipeEntries = (() => {
    const links = dynRes?.links;
    if (!links) return [];
    return Object.entries(links as Record<string, any>).map(([id, ld]) => {
      const pp = (dataRef.current?.pipes as any)?.find?.((p: any) => p.id === id);
      const dfa = ld?.depthFraction || [], fl = ld?.flow || [];
      const dfPeak = dfa.length ? Math.max(0, ...dfa) : 0;
      const flowPeak = fl.length ? Math.max(0, ...fl.map(Math.abs)) : 0;
      return { id, df: dfPeak, flowPeak, diam: pp?.diam || 0.3, from: pp?.from ?? "?", to: pp?.to ?? "?" };
    }).filter(x => x.df > 0.001 || x.flowPeak > 0.001);
  })();
  const representativeSystemPipe = [...pipeEntries].sort((a, b) => b.flowPeak - a.flowPeak)[0] || null;

  // 当前情景的现状/优化统一数据源：同一次前端流程中由原 SWMM 接口先后返回。
  const comparisonRainfallKey = (resultScenario.rainfall || scn) as RainfallScenarioKey;
  const baselineResult = baselineCacheRef.current[comparisonRainfallKey] || null;
  const optimizedResult = resultScenario.mode === "optimize" && resultScenario.rainfall === comparisonRainfallKey ? dynRes : null;
  const baselineMetrics = useMemo(() => deriveHydroMetrics(baselineResult, dataRef.current), [baselineResult]);
  const optimizedMetrics = useMemo(() => lidRedistApplied ? deriveHydroMetrics(optimizedResult, dataRef.current) : null, [optimizedResult, lidRedistApplied]);
  const runoffComparisonOption = useMemo(() => {
    const scenario = scnOf(comparisonRainfallKey);
    const timeValues: number[] = baselineResult?.timestamps || optimizedResult?.timestamps || [];
    const categories = timeValues.map(fmtTime);
    const rainfall = categories.map((_: string, idx: number) => {
      if (!scenario?.ts?.length) return 0;
      const sourceIdx = Math.min(scenario.ts.length - 1, Math.floor((idx / Math.max(1, categories.length - 1)) * (scenario.ts.length - 1)));
      return scenario.ts[sourceIdx] ?? 0;
    });
    const emptyOptimized = categories.map(() => null);
    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 52, right: 52, top: 34, bottom: 30 },
      legend: { top: 2, textStyle: { color: "#475569", fontSize: 11 }, data: ["降雨过程", "现状基准", "海绵优化"] },
      tooltip: { trigger: "axis", axisPointer: { type: "line", lineStyle: { color: "#94a3b8" } }, backgroundColor: "rgba(255,255,255,.96)", borderColor: "#dbe4ef", textStyle: { color: "#334155", fontSize: 12 } },
      xAxis: { type: "category", data: categories, name: "时间", nameTextStyle: { color: "#64748b", fontSize: 11 }, axisLabel: { color: "#64748b", fontSize: 10, interval: Math.max(0, Math.floor(categories.length / 6) - 1) }, axisLine: { lineStyle: { color: "#cbd5e1" } }, axisTick: { lineStyle: { color: "#cbd5e1" } } },
      yAxis: [
        { type: "value", name: "径流量 (m³/s)", nameTextStyle: { color: "#64748b", fontSize: 10 }, axisLabel: { color: "#64748b", fontSize: 10 }, splitLine: { lineStyle: { color: "#e8eef5" } }, axisLine: { show: false } },
        { type: "value", name: "降雨 (mm/h)", nameTextStyle: { color: "#64748b", fontSize: 10 }, axisLabel: { color: "#64748b", fontSize: 10 }, splitLine: { show: false }, axisLine: { show: false } },
      ],
      series: [
        { name: "降雨过程", type: "bar", yAxisIndex: 1, data: rainfall, barMaxWidth: 5, itemStyle: { color: "#14b8a6", opacity: 0.34 } },
        { name: "现状基准", type: "line", data: baselineMetrics?.runoffSeries || [], smooth: false, showSymbol: false, lineStyle: { color: "#94a3b8", width: 1.8 } },
        { name: "海绵优化", type: "line", data: optimizedMetrics?.runoffSeries || emptyOptimized, smooth: false, showSymbol: false, connectNulls: false, lineStyle: { color: "#2563eb", width: 2.2 } },
      ],
    };
  }, [comparisonRainfallKey, baselineResult, optimizedResult, baselineMetrics, optimizedMetrics]);
  const representativePipeId = selected?.type === "pipe" && dynRes?.links?.[selected.data.id]
    ? selected.data.id
    : (representativeSystemPipe?.id || autoPipeId);
  const representativePipe = representativePipeId ? (dataRef.current?.pipes as any[])?.find((p: any) => p.id === representativePipeId) : null;
  const representativePipeResult = representativePipeId ? dynRes?.links?.[representativePipeId] : null;

  // ── 阈值跨越异常事件(全时序预计算,跨阈值仅记首次;点击跳转时间+定位三维+同步横截面) ──
  const [events, setEvents] = useState<Array<{ idx: number; type: string; label: string; id: string; kind: "node" | "pipe" }>>([]);
  useEffect(() => {
    if (!dynRes?.links || !dynRes?.nodes || !dynRes?.timestamps?.length) { setEvents([]); return; }
    const links = dynRes.links as Record<string, any>;
    const nodes = dynRes.nodes as Record<string, any>;
    const ev: Array<{ idx: number; type: string; label: string; id: string; kind: "node" | "pipe" }> = [];
    const addEvent = (idx: number, type: string, label: string, id: string, kind: "node" | "pipe") => { ev.push({ idx: Math.max(0, Math.min(idx, dynRes.timestamps.length - 1)), type, label, id, kind }); };
    // 管道 — 五档状态机(经 getPipeLoadState 判定;跨状态记一次进入/恢复,不生成每条管道峰值流量——那在复盘)
    for (const [id, ld] of Object.entries(links)) {
      const df = ld?.depthFraction as number[] | undefined;
      if (!df?.length) continue;
      let prev: string = "normal";
      for (let i = 0; i < df.length; i++) {
        const cur = getPipeLoadState(df[i] ?? 0);
        if (cur === prev) continue;
        if (cur === "normal") { addEvent(i, "recover", "恢复正常", id, "pipe"); }
        else { addEvent(i, cur, "进入" + pipeLoadLabel(df[i] ?? 0), id, "pipe"); }
        prev = cur;
      }
    }
    // 节点 — 积水状态机(开始积水/积水消退)
    for (const [id, nd] of Object.entries(nodes)) {
      const pv = nd?.pondedVolume as number[] | undefined;
      if (!pv?.length) continue;
      let ponding = false;
      for (let i = 0; i < pv.length; i++) {
        const isP = (pv[i] ?? 0) > 0.001;
        if (isP && !ponding) { addEvent(i, "pond", "开始积水", id, "node"); ponding = true; }
        else if (!isP && ponding) { addEvent(i, "drain", "积水消退", id, "node"); ponding = false; }
      }
    }
    // 按时间排序(不截断 slice(40)——状态机事件已经是"状态跨越"而非逐帧,数量有限)
    ev.sort((a, b) => a.idx - b.idx);
    setEvents(ev);
  }, [dynRes]);
  const jumpToEvent = (e: { idx: number; id: string; kind: "node" | "pipe" }) => {
    setDynStep(e.idx); setDynPlay(false);
    if (e.kind === "pipe") { jumpToObject(e.id, "pipe"); const m = pipeMeshMap.current.get(e.id); if (m && selRef.current !== m) { if (selRef.current) resetHL(selRef.current); selRef.current = m; hlObj(m); } setSelected({ type: "pipe", data: { ...((pipeMeshMap.current.get(e.id) as any)?.userData?.data || {}), id: e.id } }); }
    else { jumpToObject(e.id, "node"); const ng = nodeGeomMap.current.get(e.id); if (ng && selRef.current !== ng.group) { if (selRef.current) resetHL(selRef.current); selRef.current = ng.group; hlObj(ng.group); } setSelected({ type: "node", data: { ...((nodeGeomMap.current.get(e.id) as any)?.group?.userData?.data || {}), id: e.id } }); }
  };

  const dynamicResultsVisible = mode === "dynamic" && !!dynRes?.ok
    && (dynPhase === "running" || dynPhase === "paused" || dynPhase === "done" || dynPhase === "ready")
    && timeStepCount > 0;
  const resultTrayHeight = dynamicResultsVisible
    ? (bottomCollapsed ? 42 : Math.max(180, Math.min(380, bottomH)))
    : 0;
  const sidePanelBottom = resultTrayHeight > 0 ? resultTrayHeight + 20 : 12;
  const staticOverviewVisible = mode === "static" && staticOverviewOpen && !selected;
  const staticObjectVisible = mode === "static" && !!selected;

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <div className={`relative flex h-[calc(100vh-3.5rem)] min-h-[620px] flex-col overflow-hidden bg-slate-100 text-slate-900 ${mode === "dynamic" ? "sandbox-dynamic-fonts" : ""}`}>
      <style>{`
        .sandbox-dynamic-fonts [class~="text-[7px]"] { font-size: 9px !important; }
        .sandbox-dynamic-fonts [class~="text-[8px]"] { font-size: 10px !important; }
        .sandbox-dynamic-fonts [class~="text-[9px]"] { font-size: 11px !important; }
        .sandbox-dynamic-fonts [class~="text-[10px]"] { font-size: 12px !important; }
        .sandbox-dynamic-fonts [class~="text-[11px]"] { font-size: 13px !important; }
        .sandbox-dynamic-fonts [class~="text-xs"] { font-size: 14px !important; }
        .sandbox-dynamic-fonts [class~="text-sm"] { font-size: 16px !important; }
        .sandbox-dynamic-fonts [class~="leading-3"] { line-height: 1.4 !important; }
        .sandbox-dynamic-fonts [class~="leading-4"] { line-height: 1.45 !important; }
        .sandbox-dynamic-fonts [class~="leading-5"] { line-height: 1.5 !important; }
      `}</style>
      {/* ── Top bar ── */}
      {mode === "dynamic" ? <header className="relative z-30 flex h-16 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2 text-[11px] shadow-sm sm:gap-2 sm:px-3 lg:gap-3 lg:px-4">
        <div className="hidden min-w-0 shrink lg:block lg:w-[190px] 2xl:w-[220px]">
          <div className="truncate text-sm font-bold text-slate-900">紫金雅园海绵城市沙盘</div>
          <div className="mt-0.5 hidden truncate text-[9px] text-slate-500 sm:block">北京市 · 研究区 11.80 hm² · SWMM 模型</div>
        </div>
        <div className="flex shrink-0 rounded-lg bg-slate-100 p-0.5">
          <button onClick={() => { if (selRef.current) resetHL(selRef.current); selRef.current = null; setSelected(null); setStaticOverviewOpen(true); setMode("static"); clearWaterMeshes(); }} className="rounded-md px-1.5 py-1.5 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-white hover:text-slate-800 sm:px-2.5">静态概况</button>
          <button onClick={() => { setMode("dynamic"); setSimMode("optimize"); setLandcover("green"); }} className="rounded-md bg-blue-600 px-1.5 py-1.5 text-[10px] font-semibold text-white shadow-sm sm:px-2.5">动态推演</button>
        </div>
        {/* 视角 Popover */}
        <div className="relative hidden md:block">
          <button onClick={() => setOpenBar(openBar === "view" ? null : "view")} className={"min-h-[32px] rounded-md border px-2.5 py-1.5 text-[10px] font-semibold transition-colors " + (openBar === "view" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700")}>视角 · {{ panorama: "鸟瞰", topdown: "俯视", underground: "地下" }[curView]} ▾</button>
          {openBar === "view" && (
            <div className="absolute left-0 top-full z-40 mt-1 w-28 rounded-lg border border-slate-200 bg-white p-1 text-slate-700 shadow-lg">
              {([["panorama","鸟瞰"],["topdown","俯视"],["orbit","环绕"],["reset","复位"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => { if (v === "orbit") setOrbit(o => { orbitRef.current = !o; return !o; }); else if (v === "reset") { setOrbit(false); orbitRef.current = false; flyTo("panorama"); } else flyTo(v); setOpenBar(null); }} className={"block w-full rounded px-2 py-1.5 text-left text-[10px] hover:bg-slate-50 " + (v === "orbit" && orbit ? "font-bold text-blue-600" : "")}>{l}</button>
              ))}
            </div>
          )}
        </div>
        {/* 组成 Popover */}
        <div className="relative hidden lg:block">
          <button onClick={() => setOpenBar(openBar === "layer" ? null : "layer")} className={"min-h-[32px] rounded-md border px-2.5 py-1.5 text-[10px] font-semibold transition-colors " + (openBar === "layer" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700")}>图层 ▾</button>
          {openBar === "layer" && (
            <div className="absolute left-0 top-full z-40 mt-1 w-32 rounded-lg border border-slate-200 bg-white p-1 text-slate-700 shadow-lg">
              {[{ id: "sc", l: "汇水区" },{ id: "pipes", l: "管道" },{ id: "nodes", l: "节点" }].map(({ id, l }) => (
                <button key={id} onClick={() => toggleLayer(id)} className={"block w-full rounded px-2 py-1.5 text-left text-[10px] hover:bg-slate-50 " + (layers[id] ? "font-bold text-slate-800" : "text-slate-400")}>{layers[id] ? "☑ " : "☐ "}{l}</button>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex min-w-0 items-end gap-2">
          <label className="hidden min-w-0 flex-col gap-0.5 text-[8px] text-slate-500 sm:flex">
            <span>降雨条件</span>
            <select value={scn} onChange={e => {
              const nextScenario = e.target.value as RainfallScenarioKey;
              if (nextScenario === scn && dynPhase === "config") return;
              setScn(nextScenario); setRainPreview(null); setDynPlay(false); setDynStep(0); setDynRes(null); setDynPhase("config"); setLidRedistApplied(false);
              setResultScenario({ mode: "optimize", lidStrategy, rainfall: null }); clearWaterMeshes();
            }} className="h-8 min-w-[138px] rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
              {RAIN_SCENARIOS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <select value={lidStrategy} onChange={e => {
            const nextStrategy = e.target.value as LidStrategyKey;
            setLidStrategy(nextStrategy); setSimMode("optimize"); setLandcover("green"); setRainPreview(null);
            setDynPlay(false); setDynStep(0); setDynRes(null); setDynPhase("config"); setLidRedistApplied(false);
            setResultScenario({ mode: "optimize", lidStrategy: nextStrategy, rainfall: null }); clearWaterMeshes();
          }} aria-label="优化情景" className="hidden h-8 min-w-0 max-w-[106px] rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 min-[360px]:block sm:hidden">
            {(Object.keys(LID_STRATEGY_MAP) as LidStrategyKey[]).map(key => <option key={key} value={key}>{LID_STRATEGY_MAP[key].label}</option>)}
          </select>
          <button onClick={resetLayout} title="恢复面板默认尺寸" className="hidden h-8 shrink-0 rounded-md px-2 text-[9px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 xl:block">恢复布局</button>
          {dynPhase === "loading"
            ? <span className="flex h-8 shrink-0 items-center rounded-md border border-blue-200 bg-blue-50 px-3 text-[10px] font-bold text-blue-700">计算中…</span>
            : <button onClick={() => loadSim()} className="flex h-8 shrink-0 items-center rounded-md bg-blue-600 px-3 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-blue-700">▶ 开始推演</button>}
        </div>
      </header> : <header className="relative z-30 flex h-16 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2 text-[11px] shadow-sm sm:gap-2 sm:px-3 lg:gap-3 lg:px-4">
        <div className="hidden min-w-0 shrink lg:block lg:w-[190px] 2xl:w-[220px]">
          <div className="truncate text-sm font-bold text-slate-900">紫金雅园海绵城市沙盘</div>
          <div className="mt-0.5 truncate text-[9px] text-slate-500">北京市 · 研究区 11.80 hm² · SWMM 模型</div>
        </div>
        <div className="flex shrink-0 rounded-lg bg-slate-100 p-0.5">
          <button onClick={() => { if (selRef.current) resetHL(selRef.current); selRef.current = null; setSelected(null); setStaticOverviewOpen(true); setMode("static"); clearWaterMeshes(); }} className="rounded-md bg-blue-600 px-1.5 py-1.5 text-[10px] font-semibold text-white shadow-sm sm:px-2.5">静态概况</button>
          <button onClick={() => { setMode("dynamic"); setSimMode("optimize"); setLandcover("green"); }} className="rounded-md px-1.5 py-1.5 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-white hover:text-slate-800 sm:px-2.5">动态推演</button>
        </div>
        <div className="relative hidden md:block">
          <button onClick={() => setOpenBar(openBar === "view" ? null : "view")} className={"min-h-[32px] rounded-md border px-2.5 py-1.5 text-[10px] font-semibold transition-colors " + (openBar === "view" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700")}>视角 · {{ panorama: "鸟瞰", topdown: "俯视", underground: "地下" }[curView]} ▾</button>
          {openBar === "view" && <div className="absolute left-0 top-full z-40 mt-1 w-28 rounded-lg border border-slate-200 bg-white p-1 text-slate-700 shadow-lg">
            {([["panorama","鸟瞰"],["topdown","俯视"],["orbit","环绕"],["reset","复位"]] as const).map(([v, l]) => <button key={v} onClick={() => { if (v === "orbit") setOrbit(o => { orbitRef.current = !o; return !o; }); else if (v === "reset") { setOrbit(false); orbitRef.current = false; flyTo("panorama"); } else flyTo(v); setOpenBar(null); }} className={"block w-full rounded px-2 py-1.5 text-left text-[10px] hover:bg-slate-50 " + (v === "orbit" && orbit ? "font-bold text-blue-600" : "")}>{l}</button>)}
          </div>}
        </div>
        <div className="relative hidden lg:block">
          <button onClick={() => setOpenBar(openBar === "layer" ? null : "layer")} className={"min-h-[32px] rounded-md border px-2.5 py-1.5 text-[10px] font-semibold transition-colors " + (openBar === "layer" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700")}>图层 ▾</button>
          {openBar === "layer" && <div className="absolute left-0 top-full z-40 mt-1 w-32 rounded-lg border border-slate-200 bg-white p-1 text-slate-700 shadow-lg">
            {[{ id: "sc", l: "汇水区" },{ id: "pipes", l: "管道" },{ id: "nodes", l: "节点" }].map(({ id, l }) => <button key={id} onClick={() => toggleLayer(id)} className={"block w-full rounded px-2 py-1.5 text-left text-[10px] hover:bg-slate-50 " + (layers[id] ? "font-bold text-slate-800" : "text-slate-400")}>{layers[id] ? "☑ " : "☐ "}{l}</button>)}
          </div>}
        </div>
        <span className="ml-auto hidden shrink-0 text-[9px] text-slate-500 sm:block">{stats.scs} 汇水区 · {stats.nodes} 节点 · {stats.pipes} 管段</span>
      </header>}

      {/* ── 左侧情景栏：仅重排展示，点击副作用保持原样 ── */}
      {mode === "dynamic" && (
        <aside style={{ bottom: sidePanelBottom }} className="absolute left-3 top-[76px] z-20 hidden w-[190px] min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex">
          <div className="mb-2">
            <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-blue-600">优化目标</div>
            <div className="mt-1 text-[8px] leading-3 text-slate-500">选择情景后，将与现状基准使用同一降雨条件计算。</div>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-1.5 overflow-y-auto">
              {(Object.keys(LID_STRATEGY_MAP) as LidStrategyKey[]).map(key => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    if (key === lidStrategy && dynPhase === "config") return;
                    setLidStrategy(key); setSimMode("optimize"); setLandcover("green"); setRainPreview(null);
                    setDynPlay(false); setDynStep(0); setDynRes(null); setDynPhase("config"); setLidRedistApplied(false);
                    setResultScenario({ mode: "optimize", lidStrategy: key, rainfall: null }); clearWaterMeshes();
                  }}
                  className={`min-w-0 rounded-lg border px-2.5 py-2 text-left transition-all ${lidStrategy === key ? "border-blue-200 bg-blue-50 text-blue-800 shadow-sm" : "border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50"}`}
                >
                  <span className="flex items-center gap-2 text-[10px] font-bold"><span className={`flex h-5 w-5 items-center justify-center rounded-md text-[8px] ${lidStrategy === key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>{(Object.keys(LID_STRATEGY_MAP) as LidStrategyKey[]).indexOf(key) + 1}</span>{LID_STRATEGY_MAP[key].label}</span>
                  <span className="mt-1.5 block pl-7 text-[8px] leading-3 text-slate-500">{LID_STRATEGY_DESC[key]}</span>
                </button>
              ))}
          </div>
          <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-[8px] leading-3 text-slate-500">
            <span className="block font-semibold text-slate-700">当前降雨 · {scnOf(scn)?.label}</span>
            <span className="mt-0.5 block">总雨量 {scnOf(scn)?.totalRainfall.toFixed(1)} mm · 峰值 {scnOf(scn)?.peakIntensity.toFixed(1)} mm/h</span>
          </div>
        </aside>
      )}
      {/* ── Three.js canvas ── */}
      <div
        style={mode === "dynamic" ? { marginBottom: sidePanelBottom } : undefined}
        className={`relative min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-[#edf3f9] shadow-sm ${mode === "dynamic" ? `mx-3 mt-3 sm:ml-[212px] ${rightCollapsed ? "xl:mr-[58px]" : "xl:mr-[308px]"}` : `m-3 ${staticOverviewVisible ? "md:ml-[388px]" : ""} ${staticObjectVisible ? "lg:mr-[248px]" : ""}`}`}
      >
        <div ref={cr} className="absolute inset-0" />
        <div className="pointer-events-none absolute left-3 top-3 z-[5] rounded-lg border border-slate-200 bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
          <div className="text-[10px] font-bold text-slate-800">{mode === "dynamic" ? "三维沙盘模型" : "研究区三维模型"}</div>
          <div className="mt-0.5 text-[8px] text-slate-500">{stats.scs} 汇水区 · {stats.nodes} 节点 · {stats.pipes} 管段</div>
          <div className="mt-0.5 text-[7px] text-slate-400">拖动旋转 · 滚轮缩放 · 点击对象查看响应</div>
        </div>
        {/* 推演等待:轻量半透明层覆盖在 3D 之上,3D 保留可见;仅展示已等待时间,不伪造百分比进度 */}
        {dynPhase === "loading" && (
          <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
            <div className="rounded-xl border border-blue-100 bg-white/95 px-5 py-4 text-center shadow-xl shadow-slate-300/30 backdrop-blur-sm">
              <div className="mb-1.5 inline-block animate-spin text-2xl text-blue-600">◉</div>
              <div className="text-sm font-bold text-slate-900">{runStage === "baseline" ? "正在计算现状基准" : "正在计算海绵优化情景"}</div>
              <div className="mt-1 text-[11px] text-slate-600">{scnOf(scn)?.label ? `${scnOf(scn)!.label}降雨` : "降雨"} · {LID_STRATEGY_MAP[lidStrategy].label}</div>
              <div className="mt-0.5 text-[9px] text-slate-500">{runStage === "baseline" ? "步骤 1/2 · 相同降雨与阀门条件" : "步骤 2/2 · LID 情景计算"}</div>
              <div className="mt-2 font-mono text-[11px] text-slate-500">已等待 {loadingSec.toFixed(1)} s</div>
            </div>
          </div>
        )}
        {deltaLabels.map(l => (
          <div key={l.id} ref={el => { if (!el) return; let it = deltaLabelsRef.current.find(x => x.id === l.id); if (!it) { it = { id: l.id, el: null }; deltaLabelsRef.current.push(it); } it.el = el; }} className="absolute hidden z-30 pointer-events-none -translate-x-1/2 -translate-y-full" style={{ left: 0, top: 0 }}>
            <div className="bg-black/80 border border-gray-600 rounded px-1 py-0.5 text-[10px] font-bold shadow" style={{ color: l.color }}>{l.text}</div>
          </div>
        ))}
      </div>

      {/* ── STATIC property panel — all Chinese ── */}
      {mode === "static" && (
        staticOverviewOpen && !selected ? (
          <aside
            aria-label="紫金雅园研究区概况"
            className="absolute bottom-3 left-3 top-[76px] z-20 flex w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-600">Study Area</div>
                <h2 className="mt-0.5 text-sm font-bold text-slate-900">紫金雅园研究区概况</h2>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">北京市典型城市居住小区 · 城市雨洪与 LID 情景研究</p>
              </div>
              <button
                type="button"
                onClick={() => setStaticOverviewOpen(false)}
                aria-label="收起研究区概况"
                className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
              >
                收起
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-3">
              <section aria-labelledby="study-area-summary">
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-4 w-1 rounded-full bg-blue-600" />
                  <h3 id="study-area-summary" className="text-xs font-bold text-slate-800">研究区概况</h3>
                </div>
                <p className="text-[10px] leading-[1.65] text-slate-600">
                  研究区位于北京市，为一处典型城市居住小区，总面积约 11.80 hm²（118,000 m²）。地势总体较为平缓，平均坡度约 1.39%，局部区域存在一定地形起伏。北京市属温带季风气候，降水主要集中在夏季，短历时强降雨容易引发地表积水、雨水径流增加和面源污染等问题。
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2">
                    <div className="text-lg font-bold tabular-nums text-blue-700">11.80 <span className="text-[10px] font-medium">hm²</span></div>
                    <div className="mt-0.5 text-[9px] text-slate-500">研究区总面积 · 118,000 m²</div>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2">
                    <div className="text-lg font-bold tabular-nums text-emerald-700">1.39%</div>
                    <div className="mt-0.5 text-[9px] text-slate-500">研究区平均坡度</div>
                  </div>
                </div>
                <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-semibold text-slate-700">下垫面与排水现状</div>
                  <p className="mt-1 text-[9px] leading-[1.6] text-slate-500">
                    下垫面主要包括建筑屋面、道路及其他硬化地面和绿地。现状不透水面积占比较高，部分绿地与道路基本齐平，雨水下渗和调蓄能力有限。
                  </p>
                </div>
              </section>

              <section aria-labelledby="swmm-summary">
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-4 w-1 rounded-full bg-cyan-500" />
                  <h3 id="swmm-summary" className="text-xs font-bold text-slate-800">模型概化</h3>
                </div>
                <p className="mb-2 text-[9px] leading-[1.6] text-slate-500">采用 ArcGIS 和泰森多边形方法对研究区进行概化，并建立 SWMM 模型。</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["930", "个", "子汇水区"],
                    ["86", "个", "雨水节点"],
                    ["2.2", "km", "雨水管网"],
                    ["4", "个", "排水口"],
                  ].map(([value, unit, label]) => (
                    <div key={label} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                      <div className="text-base font-bold tabular-nums text-blue-700">{value} <span className="text-[9px] font-medium text-slate-500">{unit}</span></div>
                      <div className="mt-0.5 text-[9px] text-slate-500">{label}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-labelledby="lid-summary">
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-4 w-1 rounded-full bg-emerald-500" />
                  <h3 id="lid-summary" className="text-xs font-bold text-slate-800">LID 设施</h3>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-100 bg-white p-2.5 shadow-sm">
                    <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-slate-800">绿色屋顶</span><span className="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">GR</span></div>
                    <div className="mt-1 text-[9px] text-slate-500">建筑屋面</div>
                    <div className="mt-1 text-[10px] font-semibold tabular-nums text-blue-700">最大适建 7,055.46 m²</div>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-white p-2.5 shadow-sm">
                    <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-slate-800">植草沟</span><span className="rounded border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">VS</span></div>
                    <div className="mt-1 text-[9px] text-slate-500">绿地 · 与 RG 共用适建空间</div>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-white p-2.5 shadow-sm">
                    <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-slate-800">雨水花园</span><span className="rounded border border-lime-100 bg-lime-50 px-1.5 py-0.5 text-[9px] font-bold text-lime-700">RG</span></div>
                    <div className="mt-1 text-[9px] text-slate-500">绿地 · 与 VS 共用适建空间</div>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-white p-2.5 shadow-sm">
                    <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-slate-800">透水铺装</span><span className="rounded border border-sky-100 bg-sky-50 px-1.5 py-0.5 text-[9px] font-bold text-sky-700">PP</span></div>
                    <div className="mt-1 text-[9px] text-slate-500">道路及其他硬化地面</div>
                    <div className="mt-1 text-[10px] font-semibold tabular-nums text-blue-700">最大适建 89,300.09 m²</div>
                  </div>
                </div>
                <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                  <div className="text-[10px] font-semibold text-emerald-800">VS 与 RG 共用绿地：最大适建面积约 13,336.22 m²</div>
                  <p className="mt-1 text-[9px] leading-[1.55] text-emerald-700/80">该数值是植草沟与雨水花园共同使用的同一片绿地上限，不是两类设施分别拥有的面积。</p>
                </div>
                <p className="mt-2 text-[9px] leading-[1.6] text-slate-500">
                  上述适建条件为后续不同 LID 组合情景及其径流控制、水质改善和生态系统服务效益模拟提供基础。
                </p>
              </section>
            </div>
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setStaticOverviewOpen(true);
            }}
            aria-label="展开紫金雅园研究区概况"
            className="absolute left-3 top-[76px] z-20 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-blue-700 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50"
          >
            研究区概况
          </button>
        )
      )}

      {mode === "static" && selected && (
        <aside className="absolute bottom-3 right-3 top-[76px] z-20 w-[min(224px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-[11px] text-slate-700 shadow-sm">
          <div className="mb-2 flex justify-between border-b border-slate-100 pb-2 text-xs font-bold text-slate-800">
            <span>{{ node: "🔹 节点", pipe: "▬ 管道", subcatchment: "▨ 汇水区" }[selected.type as string] || selected.type}</span>
            <button onClick={() => { if (selRef.current) resetHL(selRef.current); selRef.current = null; setSelected(null); }} className="text-[10px] text-slate-400 hover:text-blue-600">✕</button>
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
                <div className="mt-1 text-[8px] leading-3 text-blue-600">静态示意 · 切换“动态推演”查看实时水量变化</div>
              </div>
            )}
            {Object.entries(selected.data).map(([k, v]: [string, any]) => (
              <div key={k} className="flex min-w-0 justify-between gap-2">
                <span className="shrink-0 text-slate-500">{chineseLabel(k)}</span>
                <span className="min-w-0 break-all text-right text-slate-700">{k === "type" ? chineseType(String(v)) : formatVal(k, v)}</span>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* 静态：左侧研究区概况 / 中央三维模型 / 右侧选中对象详情。 */}

      {/* ── Timeline (dynamic only) ── */}
      {/* 方案切换结果状态条 */}
      {schemeMsg && mode === "dynamic" && (
        <div style={{ bottom: sidePanelBottom + 8 }} className={`absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-[10px] font-bold shadow-md backdrop-blur ${schemeMsg.color}`}>{schemeMsg.text}</div>
      )}
      {/* 3D 主窗口降雨曲线浮层(docx:主窗口展示降雨情景的降雨曲线,当前时刻标记同步) */}
      {/* 3D 主窗口降雨曲线浮层已删除:全页面仅保留左侧场景配置的主降雨曲线(推演时其上叠加当前时刻线) */}

      {/* 分步新手引导卡片 */}
      {guide > 0 && mode === "dynamic" && (
        <div style={{ bottom: sidePanelBottom + 12 }} className="absolute left-3 z-20 max-w-[260px] rounded-lg border border-blue-200 bg-white/95 px-3 py-2 text-[11px] text-slate-700 shadow-lg backdrop-blur sm:left-[212px]">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold text-blue-700">新手引导 {guide}/3</span>
            <button onClick={finishGuide} className="text-[10px] text-slate-400 hover:text-slate-700">跳过 ✕</button>
          </div>
          <div className="leading-4">
            {guide === 1 && <>① <b>点击任意管道</b>,查看管网横截面水量</>}
            {guide === 2 && <>② <b>切换左侧优化情景</b>，对比目标变化</>}
            {guide === 3 && <>③ <b>选择顶部降雨条件</b>，观察推演结果</>}
          </div>
          <div className="mt-1.5 text-[9px] text-blue-500">{guide === 1 ? "试试点击场景中的管道 →" : guide === 2 ? "试试点左侧情景卡片 →" : "试试切换顶部降雨条件 →"}</div>
        </div>
      )}
      {/* 下垫面方案示意图例:配置阶段显示于 3D 右下角,颜色=不透水率 */}
      {mode === "dynamic" && !dynRes && (
        <div className="pointer-events-none absolute bottom-5 left-5 z-10 rounded-lg border border-slate-200 bg-white/90 px-2.5 py-2 text-[8px] shadow-sm backdrop-blur sm:left-[224px]">
          <div className="mb-1 font-bold text-slate-700">{landcover === "green" ? "海绵优化" : "现状基准"} · 下垫面示意</div>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">不透水率低</span>
            <div className="w-24 h-1.5 rounded overflow-hidden" style={{ background: "linear-gradient(90deg,#8fa890,#b0a898,#c09088)" }} />
            <span className="text-slate-500">不透水率高</span>
          </div>
          <div className="mt-0.5 text-slate-400">地表颜色 = %Imperv 不透水率，非渗透性</div>
        </div>
      )}
      {/* 悬停 tooltip(位置由原生 mousemove 直改 style,内容变化才重渲染) */}
      <div ref={tooltipRef} className={`pointer-events-none fixed z-30 bg-black/85 border border-gray-600 rounded-md px-2 py-1 text-[10px] leading-4 text-gray-200 shadow-lg ${hoverInfo ? "" : "hidden"}`} style={{ display: hoverInfo ? undefined : "none" }}>
        {hoverInfo?.lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
      {/* 首次进入引导气泡 */}
      {showTip && mode === "dynamic" && (
        <div className="absolute left-3 top-[124px] z-20 max-w-xs rounded-lg border border-blue-200 bg-blue-50/95 px-3 py-2 text-[10px] text-blue-800 shadow-md sm:left-[212px]">
          <b>操作提示：</b>选择优化情景和降雨条件后开始推演；系统将自动计算现状基准并播放优化过程。
          <button onClick={() => setShowTip(false)} className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full border border-blue-200 bg-white text-center text-[9px] leading-4 text-blue-500 hover:text-blue-800">✕</button>
        </div>
      )}
      {/* 降雨卡已移至底部统一推演区(与24h时间轴/管道诊断同区),右上角不再驻留 */}
      {/* ── 右侧：所有情景统一的现状基准 / 海绵优化对比 ── */}
      {mode === "dynamic" && (() => {
        const links = dynRes?.links || {};
        const nodes = dynRes?.nodes || {};
        const i = dynStep;
        let highLoad = 0, fullCount = 0, pondCount = 0;
        for (const l of Object.values(links) as any[]) {
          const dfNow = (Array.isArray(l.depthFraction)) ? (l.depthFraction[i] ?? 0) : 0;
          const st = getPipeLoadState(dfNow);
          if (st === "high" || st === "nearFull" || st === "full") highLoad++;
          if (st === "full") fullCount++;
        }
        for (const n of Object.values(nodes) as any[]) {
          const pvNow = (Array.isArray(n.pondedVolume)) ? (n.pondedVolume[i] ?? 0) : 0;
          if (pvNow > 0.01) pondCount++;
        }
        const pct = timeStepCount > 1 ? Math.round((dynStep / Math.max(1, timeStepCount - 1)) * 100) : (dynPhase === "done" ? 100 : 0);
        const hasPlayback = !!dynRes?.ok && dynPhase !== "loading" && dynPhase !== "config";
        const formatMetric = (value: number | null, unit: string, decimals = 2) => value == null ? "待计算" : `${value.toFixed(decimals)} ${unit}`;
        const optimizationPending = dynRes?.ok && !lidRedistApplied ? "未生成" : "待计算";
        const metricRows = [
          { label: "径流总量", note: "排水口累计出流", baseline: baselineMetrics?.cumulativeOutflow ?? null, optimized: optimizedMetrics?.cumulativeOutflow ?? null, unit: "m³", decimals: 0 },
          { label: "峰值径流", note: "排水口合计", baseline: baselineMetrics?.peakOutflow ?? null, optimized: optimizedMetrics?.peakOutflow ?? null, unit: "m³/s", decimals: 2 },
          { label: "最大积水深度", note: "全场峰值", baseline: baselineMetrics?.maxDepth ?? null, optimized: optimizedMetrics?.maxDepth ?? null, unit: "m", decimals: 2 },
          { label: "积水节点", note: "全时段统计", baseline: baselineMetrics?.pondedNodes ?? null, optimized: optimizedMetrics?.pondedNodes ?? null, unit: "个", decimals: 0 },
        ];
        const statusLabel = dynPhase === "loading"
          ? (runStage === "baseline" ? "计算现状基准" : "计算海绵优化")
          : ({ config: "未开始", ready: "待播放", running: "推演中", paused: "已暂停", done: "推演完成" } as Record<string, string>)[dynPhase] || "未开始";
        if (rightCollapsed) return (
          <div style={{ width: 38, bottom: sidePanelBottom, right: 12 }} className="pointer-events-auto absolute top-[76px] z-20 hidden flex-col items-center overflow-hidden rounded-lg border border-slate-200 bg-white pt-3 shadow-sm xl:flex">
            <button onClick={() => setRightCollapsed(false)} title="展开右栏" className="text-base leading-none text-slate-400 hover:text-blue-600">〈</button>
          </div>
        );
        return (
          <aside style={{ width: Math.max(264, Math.min(380, rightW)), bottom: sidePanelBottom, right: 12 }} className="pointer-events-auto absolute top-[76px] z-20 hidden overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl border border-slate-200 bg-white px-3 py-3 text-[11px] text-slate-700 shadow-sm xl:block">
            <div onPointerDown={(e) => { e.preventDefault(); dragRef.current = { axis: "v", orig: rightW, start: e.clientX }; }} className="absolute -left-[4px] bottom-0 top-0 z-20 w-[8px] cursor-ew-resize hover:bg-blue-500/10" />
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-blue-600">结果对比</div>
                <div className="mt-0.5 truncate text-xs font-bold text-slate-900">现状基准 vs {LID_STRATEGY_MAP[lidStrategy].label}</div>
              </div>
              <span className="flex items-center gap-1 shrink-0">
                <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-[8px] font-semibold text-blue-700">{statusLabel}</span>
                <button onClick={() => setRightCollapsed(true)} title="收起右栏" className="h-5 w-5 rounded text-center text-[10px] leading-5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">〉</button>
              </span>
            </div>
            <p className="mb-2 text-[9px] leading-4 text-slate-500">{LID_STRATEGY_DESC[lidStrategy]}</p>

            <div className="mb-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
              <div className="flex items-center justify-between text-[9px]"><span className="text-slate-500">统一降雨条件</span><span className="font-semibold text-blue-700">{scnOf(comparisonRainfallKey)?.label}</span></div>
              <div className="mt-1 flex items-center justify-between text-[8px] text-slate-400"><span>现状基准：中性灰</span><span>海绵优化：蓝色</span></div>
              {hasPlayback && (<>
                <div className="mt-2 flex justify-between text-[9px]"><span className="text-slate-500">时间 {currentTimeLabel}</span><span className="font-medium text-slate-700">进度 {pct}%</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} /></div>
              </>)}
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              {metricRows.map(metric => {
                const change = reductionLabel(metric.baseline, metric.optimized);
                return (
                  <div key={metric.label} className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2"><span className="truncate text-[9px] font-semibold text-slate-800">{metric.label}</span><span className="text-[7px] text-slate-400">{metric.note}</span></div>
                    <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-1.5 text-[8px]">
                      <div className="min-w-0"><span className="block text-[7px] text-slate-500">现状基准</span><span className="block truncate font-mono text-slate-600">{formatMetric(metric.baseline, metric.unit, metric.decimals)}</span></div>
                      <span className="pb-0.5 text-slate-400">→</span>
                      <div className="min-w-0 text-right"><span className="block text-[7px] text-blue-500">海绵优化</span><span className="block truncate font-mono font-semibold text-blue-700">{metric.optimized == null ? optimizationPending : formatMetric(metric.optimized, metric.unit, metric.decimals)}</span></div>
                    </div>
                    <div className={`mt-1 text-[8px] font-semibold ${change.startsWith("↓") ? "text-emerald-600" : change.startsWith("↑") ? "text-amber-600" : "text-slate-400"}`}>改善比例：{change}</div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="flex items-start justify-between gap-2">
                <div><div className="text-[9px] font-semibold text-slate-800">典型管段响应</div><div className="text-[7px] text-slate-400">代表性管段，不代表全部管网</div></div>
                <span className="text-[9px] font-mono text-slate-600">{representativePipeId || "暂无"}</span>
              </div>
              {representativePipe && representativePipeResult ? <div className="mt-1.5 flex items-center gap-2">
                <PipeCrossSection compact largeLabels diam={representativePipe.diam || 0.3} depth={representativePipeResult.depth?.[dynStep] ?? 0} depthFraction={representativePipeResult.depthFraction?.[dynStep] ?? 0} flow={representativePipeResult.flow?.[dynStep] ?? 0} flowDir={`${representativePipe.from ?? "?"} → ${representativePipe.to ?? "?"}`} landcover={landcover} animate={false} />
                <div className="min-w-0 flex-1 space-y-1 text-[8px]">
                  <div className="flex justify-between gap-2"><span className="text-slate-500">流量</span><span className="font-mono font-semibold text-blue-700">{(representativePipeResult.flow?.[dynStep] ?? 0).toFixed(3)} m³/s</span></div>
                  <div className="flex justify-between gap-2"><span className="text-slate-500">流速</span><span className="font-mono text-slate-600">{(representativePipeResult.velocity?.[dynStep] ?? 0).toFixed(3)} m/s</span></div>
                  <div className="flex justify-between gap-2"><span className="text-slate-500">充满度</span><span className="font-mono font-semibold text-blue-700">{((representativePipeResult.depthFraction?.[dynStep] ?? 0) * 100).toFixed(0)}%</span></div>
                </div>
              </div> : <div className="flex h-16 items-center justify-center text-[9px] text-slate-400">推演后显示管段时序</div>}
            </div>
            {!dynRes?.ok && <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/70 px-2.5 py-2 text-[9px] leading-4 text-slate-600">未开始：开始推演后将先计算现状基准，再计算所选优化情景，并自动播放过程。</div>}
            {dynRes?.ok && !lidRedistApplied && resultScenario.mode === "optimize" && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[8px] leading-3 text-amber-700">当前模型未成功应用LID空间重分配，因此不将本次返回值标记为优化结果。现状数据保留，优化指标显示“未生成”。</div>}

            {hasPlayback && <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
              <div className="mb-1 text-[9px] font-semibold text-slate-700">当前管网响应</div>
              <div className="grid grid-cols-3 gap-1 text-center text-[8px]">
                <div><div className="text-slate-500">高负荷</div><div className="font-semibold text-amber-600">{highLoad}</div></div>
                <div><div className="text-slate-500">满管</div><div className="font-semibold text-orange-600">{fullCount}</div></div>
                <div><div className="text-slate-500">积水节点</div><div className="font-semibold text-rose-600">{pondCount}</div></div>
              </div>
            </div>
            }
            {(dynPhase === "running" || dynPhase === "paused") && (
              <div className="mt-2 flex gap-1.5 border-t border-slate-100 pt-2">
                {dynPhase === "running"
                  ? <button onClick={() => { setDynPlay(false); setDynPhase("paused"); }} className="flex-1 rounded-md border border-amber-200 bg-amber-50 py-1 text-[9px] font-bold text-amber-700">暂停</button>
                  : <button onClick={() => { setDynPlay(true); setDynPhase("running"); }} className="flex-1 rounded-md border border-emerald-200 bg-emerald-50 py-1 text-[9px] font-bold text-emerald-700">继续</button>}
                <button onClick={() => { setDynPlay(false); setDynPhase("done"); }} className="flex-1 rounded-md border border-slate-200 bg-white py-1 text-[9px] font-bold text-slate-600">结束播放</button>
              </div>
            )}

            {hasPlayback && <div className="mt-2 border-t border-slate-100 pt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-[9px] text-slate-600">当前异常</span>
                <span className="text-[8px] text-slate-400">{events.filter(e => e.idx <= dynStep).length} 条</span>
              </div>
              <div className="max-h-[72px] space-y-0.5 overflow-y-auto text-[8px]">
                {events.filter(e => e.idx <= dynStep).slice().reverse().slice(0, showEvents ? undefined : 3).map((e, idx) => (
                  <button key={e.type + e.id + idx} onClick={() => jumpToEvent(e)} title="跳转时间并定位三维对象"
                    className={"flex items-center gap-1 w-full text-left px-1 py-0.5 rounded hover:bg-slate-50 " + (e.idx === dynStep ? "bg-blue-50 ring-1 ring-blue-200" : "")}>
                    <span className="shrink-0 font-mono text-slate-400">{fmtTime(dynRes.timestamps?.[e.idx] ?? 0)}</span>
                    <span className="shrink-0 px-1 rounded text-[8px] text-white font-bold" style={{ background: e.type === "full" ? "#b45309" : e.type === "nearFull" ? "#ca8a04" : e.type === "high" ? "#f59e0b" : e.type === "medium" ? "#64748b" : e.type === "recover" ? "#6b7280" : e.type === "pond" ? "#be123c" : e.type === "drain" ? "#0e7490" : "#6b7280" }}>{e.label}</span>
                    <span className="truncate text-slate-600">{e.id}</span>
                    <span className="ml-auto text-[8px] text-slate-400">{e.kind === "pipe" ? "▬" : "◆"}</span>
                  </button>
                ))}
                {events.filter(e => e.idx <= dynStep).length === 0 && <div className="text-[8px] text-slate-400">当前无跨阈值异常</div>}
              </div>
              {(!showEvents ? events.filter(e => e.idx <= dynStep).length > 3 : true) && events.filter(e => e.idx <= dynStep).length > 0 && (
                <button onClick={() => setShowEvents(v => !v)} className="mt-0.5 text-[8px] text-blue-600 hover:text-blue-800">{showEvents ? "▲ 收起" : "查看全部事件 ▾"}</button>
              )}
            </div>}

            {selected && hasPlayback && (
              <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-[9px]">
                <div className="mb-1 flex items-center justify-between font-bold text-slate-700">
                  <span>{selected.type === "node" ? "节点" : "管段"} · {selected.data.id}</span>
                  <button onClick={() => { if (selRef.current) resetHL(selRef.current); selRef.current = null; setSelected(null); }} className="text-[8px] text-slate-400 hover:text-blue-600">清除选择</button>
                </div>
                {selected.type === "node" && curNodeData && (<>
                  <div className="flex justify-between"><span className="text-slate-500">当前水深</span><span className="text-slate-700">{(curNodeData.depth?.[dynStep]??0).toFixed(3)} m</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">总入流</span><span className="text-slate-700">{(curNodeData.totalInflow?.[dynStep]??0).toFixed(3)} m³/s</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">地表积水体积</span><span className={(curNodeData.pondedVolume?.[dynStep]??0)>0.01?"text-red-600":"text-slate-700"}>{(curNodeData.pondedVolume?.[dynStep]??0).toFixed(3)} m³</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">洪泛损失</span><span className={(curNodeData.floodingLosses?.[dynStep]??0)>0.01?"text-red-600":"text-slate-700"}>{(curNodeData.floodingLosses?.[dynStep]??0).toFixed(3)}</span></div>
                </>)}
                {selected.type === "pipe" && curLinkData && (<>
                  <div className="flex justify-between"><span className="text-slate-500">当前流量</span><span className="text-slate-700">{(curLinkData.flow?.[dynStep]??0).toFixed(3)} m³/s</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">当前流速</span><span className="text-slate-700">{(curLinkData.velocity?.[dynStep]??0).toFixed(3)} m/s</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">水深</span><span className="text-slate-700">{(curLinkData.depth?.[dynStep]??0).toFixed(3)} m</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">充满度</span><span className="text-slate-700">{((curLinkData.depthFraction?.[dynStep]??0)*100).toFixed(0)}%</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">运行负荷</span><span className="text-slate-700">{pipeLoadLabel(curLinkData.depthFraction?.[dynStep] ?? 0)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">流向</span><span className="text-slate-700">{(curLinkData.flow?.[dynStep]??0)>=0 ? "→ "+selected.data.to : "← "+selected.data.from}</span></div>
                  {(!selected.data.shape || String(selected.data.shape).toUpperCase() === "CIRCULAR") && <div className="mt-1.5 rounded border border-blue-100 bg-blue-50 p-1.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-blue-700">调节阀</span>
                      {(valves[selected.data.id] != null || valveDraft[selected.data.id] != null) && <button onClick={() => resetValves(selected.data.id)} className="text-[9px] text-blue-500 hover:text-blue-800">重置</button>}
                    </div>
                    <input type="range" min="0" max="100" step="5" value={Math.round((valveDraft[selected.data.id] ?? valves[selected.data.id] ?? 1) * 100)} onChange={e => onValveChange(selected.data.id, Number(e.target.value))} className="w-full accent-blue-600" />
                    <div className="flex justify-between text-[9px] text-slate-500"><span>关闭</span><span className="font-bold text-blue-700">{Math.round((valveDraft[selected.data.id] ?? valves[selected.data.id] ?? 1) * 100)}%</span><span>全开</span></div>
                    {(valves[selected.data.id] != null && valveDraft[selected.data.id] == null) && <div className="mt-0.5 text-[9px] leading-3 text-blue-500">已生效，拖动调整后松手重新仿真</div>}
                  </div>}
                </>)}
                <div className="pt-0.5 text-[8px] text-slate-400">代表性管段剖面显示在右侧“典型管段响应”。</div>
              </div>
            )}
          </aside>
        );
      })()}
      {dynamicResultsVisible && (
        <section style={{ height: resultTrayHeight }} className={`absolute bottom-3 left-3 right-3 z-10 overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 shadow-sm sm:left-[212px] ${rightCollapsed ? "xl:right-[58px]" : "xl:right-[308px]"}`}>
          <div onPointerDown={(e) => { e.preventDefault(); dragRef.current = { axis: "h", orig: bottomH, start: e.clientY }; }} className="absolute left-0 right-0 top-0 z-20 h-[6px] cursor-ns-resize hover:bg-blue-500/10" />
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-xs font-bold text-slate-900">情景结果与过程曲线</span>
              <span className="ml-2 text-[9px] text-slate-500">{LID_STRATEGY_MAP[lidStrategy].label} · {scnOf(comparisonRainfallKey)?.label} · 现状灰 / 优化蓝</span>
            </div>
            <button onClick={() => setBottomCollapsed(v => !v)} className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">{bottomCollapsed ? "展开结果" : "收起结果"}</button>
          </div>

          {!bottomCollapsed && <div className="grid min-w-0 grid-cols-1 gap-3">
            <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-1.5">
              {lidStrategy === "runoff" && (<>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[9px]">
                  <span className="font-semibold text-blue-700">降雨—径流过程对比</span>
                  <span className="text-slate-500">峰现时间：现状 {baselineMetrics?.peakTime != null ? fmtTime(baselineMetrics.peakTime) : "待计算"} · 优化 {optimizedMetrics?.peakTime != null ? fmtTime(optimizedMetrics.peakTime) : "待计算"}</span>
                </div>
                <ReactEChartsCore echarts={echarts} option={runoffComparisonOption} style={{ height: 138, width: "100%" }} notMerge />
                {!lidRedistApplied && <div className="mt-1 text-[8px] text-amber-600">海绵优化曲线将在模型成功应用LID空间重分配后显示。</div>}
              </>)}

              {lidStrategy === "balanced" && (<>
                <div className="mb-2 text-[9px] font-semibold text-blue-700">综合目标摘要</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "径流控制", value: reductionLabel(baselineMetrics?.cumulativeOutflow ?? null, optimizedMetrics?.cumulativeOutflow ?? null), state: "SWMM派生" },
                    { label: "峰值流量", value: reductionLabel(baselineMetrics?.peakOutflow ?? null, optimizedMetrics?.peakOutflow ?? null), state: "SWMM派生" },
                    { label: "污染负荷", value: "待接入", state: "接口未返回水质结果" },
                    { label: "生态服务效益", value: "待接入", state: "需生态效益模型" },
                  ].map(item => <div key={item.label} className="rounded-lg border border-slate-100 bg-white px-2 py-2"><div className="text-[9px] text-slate-600">{item.label}</div><div className="mt-1 text-sm font-bold text-blue-700">{item.value}</div><div className="mt-1 text-[7px] text-slate-400">{item.state}</div></div>)}
                </div>
                <div className="mt-2 text-[8px] leading-3 text-slate-500">均衡型同时保留水动力、水质和生态目标；当前仅水动力指标具备真实结果。</div>
              </>)}

              {lidStrategy === "waterquality" && (<>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[9px] font-semibold text-blue-700">污染物浓度与负荷对比</span>
                  <div className="flex gap-1">{WATER_QUALITY_INDICATORS.map(pollutant => <button key={pollutant} onClick={() => setActivePollutant(pollutant)} className={`rounded border px-2 py-0.5 text-[8px] font-semibold ${activePollutant === pollutant ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500"}`}>{pollutant}</button>)}</div>
                </div>
                <div className="relative flex h-[118px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white">
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[7px] text-slate-400">时间</span>
                  <span className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[7px] text-slate-400">浓度 / 负荷</span>
                  <div className="text-center"><div className="text-[10px] font-semibold text-slate-600">{activePollutant} 暂无时序结果</div><div className="mt-1 text-[8px] text-slate-400">INP已配置该污染物，当前SWMM接口尚未返回浓度与负荷字段</div></div>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[8px] text-slate-400"><span>现状基准：待接入</span><span>海绵优化：待接入</span><span>负荷削减率：待接入</span></div>
              </>)}

              {lidStrategy === "ecological" && (<>
                <div className="mb-2 text-[9px] font-semibold text-blue-700">生态系统服务指标</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ECO_SERVICE_INDICATORS.map(item => <div key={item.label} className="rounded-lg border border-slate-100 bg-white px-2 py-2"><div className="text-[9px] text-slate-700">{item.label}</div><div className="mt-1 text-sm font-bold text-slate-400">待接入</div><div className="text-[7px] text-slate-400">单位 {item.unit}</div><div className="mt-1 text-[7px] text-slate-400">来源状态：{item.source}未接入</div></div>)}
                </div>
                <div className="mt-2 text-[8px] leading-3 text-slate-500">当前SWMM响应不包含碳、热环境、雨水利用或生态价值结果，因此不生成估算值。</div>
              </>)}
            </div>
          </div>}

          {!bottomCollapsed && <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-slate-100 pt-2">
            <span className="w-12 shrink-0 text-right font-mono text-[10px] font-semibold text-slate-700">{currentTimeLabel}</span>
            <input type="range" min={0} max={timeStepCount - 1} value={dynStep} onChange={e => { setDynStep(+e.target.value); if (dynPlay) { setDynPlay(false); setDynPhase("paused"); } }} title="拖动查看任意时刻" className="h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600" />
            <select value={dynSpd} onChange={e => setDynSpd(+e.target.value)} className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-1 text-[9px] text-slate-600"><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={5}>5×</option></select>
            {dynPhase === "running" ? <button onClick={() => { setDynPlay(false); setDynPhase("paused"); }} className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-semibold text-amber-700">暂停</button> : <button onClick={() => { if (dynStep >= timeStepCount - 1) setDynStep(0); setDynPlay(true); setDynPhase("running"); }} className="shrink-0 rounded-md bg-blue-600 px-2 py-1 text-[9px] font-semibold text-white">播放</button>}
            <span className="shrink-0 font-mono text-[8px] text-slate-400">{fmtTime(((dynRes.timestamps?.[dynRes.timestamps.length - 1]) as number) ?? 0)}</span>
          </div>}
        </section>
      )}
      {!loaded && !error && <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-50 text-slate-700"><span className="mr-2 animate-spin">⏳</span>加载 SWMM 模型…</div>}
      {error && <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-50 text-slate-800"><div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-lg"><div className="mb-2 text-2xl">⚠️</div><div className="mb-1 text-sm">{error}</div><button onClick={()=>window.location.reload()} className="mt-3 rounded bg-red-600 px-4 py-1.5 text-xs text-white hover:bg-red-700">刷新页面</button></div></div>}
    </div>
  );
}
