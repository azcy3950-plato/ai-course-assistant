"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { getAuthToken } from "@/contexts/AppContext";
import { parseInp, type Node3D, type Pipe3D, type SC3D } from "@/lib/inp-parser";
import { computeRiskStats } from "@/lib/risk-stats";
import * as THREE from "three";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

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
// 共享几何:推演/热力图每步不再 new Geometry(长推演不掉帧)
const SHARED = {
  waterCyl: new THREE.CylinderGeometry(0.18, 0.18, 1, 8),
  heatDisc: new THREE.CircleGeometry(0.42, 16),
  overflowRing: new THREE.TorusGeometry(0.28, 0.05, 8, 10),
  flowParticle: new THREE.SphereGeometry(0.14, 6, 6),
  flowParticleMat: new THREE.MeshBasicMaterial({ color: "#7fd4ff", transparent: true, opacity: 0.85 }),
  storageTank: new THREE.CylinderGeometry(1.1, 1.1, 1.4, 16),
  storageWater: new THREE.CylinderGeometry(0.9, 0.9, 1, 12),
};

function PipeCrossSection({ diam, depth, depthFraction, flow, flowDir, landcover, previewRatio = 1, animate = true, compact = false }: {
  diam: number; depth: number; depthFraction: number; flow: number; flowDir: string; landcover: string; previewRatio?: number; animate?: boolean; compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ diam, depth, depthFraction, flow, flowDir, previewRatio, compact });
  latest.current = { diam, depth, depthFraction, flow, flowDir, previewRatio, compact };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = latest.current.compact ? 88 : 180, h = latest.current.compact ? 74 : 150;
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
      // 雨强预览:水位按 previewRatio 缩放(拖动滑条即见变化)
      const fillRatio = Math.min(1, Math.max(0, (L.depthFraction || 0) * L.previewRatio));
      const flow = L.flow;

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

      // 标注(compact 降字号防裁切)
      ctx.fillStyle = "#9fb2c0";
      ctx.font = L.compact ? "8px monospace" : "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(L.compact ? `${(fillRatio * 100).toFixed(0)}%` : `d=${L.diam.toFixed(2)}m 充满度=${(fillRatio * 100).toFixed(0)}%`, cx, h - 5);
      ctx.fillStyle = "rgba(80,170,230,0.9)";
      ctx.fillText(L.compact ? `${flow >= 0 ? "→" : "←"}${Math.abs(flow).toFixed(2)}` : `水深 ${Math.min(L.depth * L.previewRatio, L.diam).toFixed(2)}m · ${flow >= 0 ? "→" : "←"} ${Math.abs(flow).toFixed(2)}m³/s`, cx, 9);
      if (animate) raf = requestAnimationFrame(draw); // 动态模式持续绘制;静态模式画完即停
    };
    if (animate) {
      raf = requestAnimationFrame(draw);
    } else {
      draw(0); // 静态模式(如三方案对比):一次性绘制,零 rAF 空转
    }
    return () => cancelAnimationFrame(raf);
  }, [animate]);

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
function ChartPanel({ selected, dynRes, dynStep, timeStepCount, currentTimeLabel, compareRes, onSeek }: {
  selected: any; dynRes: any; dynStep: number; timeStepCount: number; currentTimeLabel: string; compareRes?: Record<string, any> | null; onSeek?: (step: number) => void;
}) {
  const [chartOpen, setChartOpen] = useState(false);
  const timestamps: number[] = dynRes?.timestamps || [];

  // 三方案系统总流量对比(各方案所有管道 flow 逐时间步求和)
  const compareData = useMemo(() => {
    if (!compareRes) return null;
    const schemes: Array<["default" | "green" | "gray", string, string]> = [["default", "现状", "#9e9e9e"], ["green", "绿色海绵", "#81c784"], ["gray", "灰色强开发", "#ff8a65"]];
    const out: Array<{ name: string; color: string; data: number[] }> = [];
    for (const [lc, name, color] of schemes) {
      const r = compareRes[lc];
      if (!r?.links) return null;
      const links = Object.values(r.links) as Array<{ flow?: number[] }>;
      const len = r.timestamps?.length || 0;
      const data: number[] = new Array(len).fill(0);
      links.forEach((ld) => { const fl = ld.flow || []; for (let i = 0; i < Math.min(len, fl.length); i++) data[i] += Math.abs(fl[i] || 0); });
      out.push({ name, color, data });
    }
    return out;
  }, [compareRes]);

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
  const [compareOpen, setCompareOpen] = useState(false);
  // 曲线点击联动时间轴(传给所有图表);dataIndex 钳制防越界
  const seekEvents = { click: (p: any) => { if (p?.dataIndex != null && onSeek) onSeek(Math.min(Math.max(0, p.dataIndex), Math.max(0, timeStepCount - 1))); } };

  // 三方案对比图(系统总流量曲线叠加),与选中对象图表可同时展示
  const compareOption = compareData ? {
    backgroundColor: 'transparent',
    grid: { top: 32, right: 12, bottom: 24, left: 48 },
    tooltip: { trigger: 'axis' as const },
    legend: { show: true, textStyle: { color: '#aaa', fontSize: 9 }, top: 2 },
    xAxis: { type: 'category' as const, data: timestamps.map((t: number) => t.toFixed(1) + 'h'), axisLabel: { color: '#888', fontSize: 9, interval: Math.max(0, Math.floor(timestamps.length / 6) - 1) } },
    yAxis: { type: 'value' as const, name: '总流量 (m³/s)', nameTextStyle: { color: '#888', fontSize: 9 }, axisLabel: { color: '#888', fontSize: 9 } },
    series: compareData.map((s) => ({ name: s.name, type: 'line' as const, data: s.data, smooth: false, symbol: 'none', lineStyle: { color: s.color, width: 1.5 } })),
  } : null;

  if (selected?.type === "node") {
    const nd = dynRes?.nodes?.[selected.data.id];
    if (!nd) return null;
    const d = nd.depth || []; const ti = nd.totalInflow || []; const pv = nd.pondedVolume || []; const fl = nd.floodingLosses || [];
    return (
      <div className="absolute left-2 right-2 bg-black/92 backdrop-blur rounded-lg border border-gray-700 z-10" style={{ bottom: 48 }}>
        {compareOption && (
          <>
            <button onClick={() => setCompareOpen(!compareOpen)} className="w-full px-3 py-1 text-left text-[10px] text-gray-400 hover:text-gray-200 flex justify-between border-b border-gray-800">
              <span>📈 三方案系统总流量对比</span><span>{compareOpen ? "收起 ▲" : "展开 ▼"}</span>
            </button>
            {compareOpen && (
              <div className="px-1 pb-1 border-b border-gray-800">
                <ReactEChartsCore echarts={echarts} option={compareOption} style={{ height: 170 }} notMerge onEvents={seekEvents} />
                <div className="px-1 pb-0.5 text-[9px] text-gray-500">灰色强开发抬高峰值 · 绿色海绵削减峰值 — 点击三方案对比按钮生成</div>
              </div>
            )}
          </>
        )}
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
        {compareOption && (
          <>
            <button onClick={() => setCompareOpen(!compareOpen)} className="w-full px-3 py-1 text-left text-[10px] text-gray-400 hover:text-gray-200 flex justify-between border-b border-gray-800">
              <span>📈 三方案系统总流量对比</span><span>{compareOpen ? "收起 ▲" : "展开 ▼"}</span>
            </button>
            {compareOpen && (
              <div className="px-1 pb-1 border-b border-gray-800">
                <ReactEChartsCore echarts={echarts} option={compareOption} style={{ height: 170 }} notMerge onEvents={seekEvents} />
                <div className="px-1 pb-0.5 text-[9px] text-gray-500">灰色强开发抬高峰值 · 绿色海绵削减峰值 — 点击三方案对比按钮生成</div>
              </div>
            )}
          </>
        )}
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

  // 无选中对象时:仅对比图
  if (compareOption) {
    return (
      <div className="absolute left-2 right-2 bg-black/92 backdrop-blur rounded-lg border border-gray-700 z-10" style={{ bottom: 48 }}>
        <button onClick={() => setCompareOpen(!compareOpen)} className="w-full px-3 py-1 text-left text-[10px] text-gray-400 hover:text-gray-200 flex justify-between">
          <span>📈 三方案系统总流量对比</span><span>{compareOpen ? "收起 ▲" : "展开 ▼"}</span>
        </button>
        {compareOpen && (
          <div className="px-1 pb-1">
            <ReactEChartsCore echarts={echarts} option={compareOption} style={{ height: 170 }} notMerge onEvents={seekEvents} />
            <div className="px-1 pb-0.5 text-[9px] text-gray-500">灰色强开发抬高峰值 · 绿色海绵削减峰值 — 点击三方案对比按钮生成</div>
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
  const storageMeshMap = useRef<Map<string, { grp: THREE.Group; tank: THREE.Mesh; water: THREE.Mesh }>>(new Map());
  const waterMeshMap = useRef<Map<string, THREE.Mesh>>(new Map());
  const spanRef = useRef(300);
  const simSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"static" | "dynamic">("static");
  const [selected, setSelected] = useState<any>(null);
  const [layers, setLayers] = useState<Record<string, boolean>>({ sc: true, pipes: true, nodes: true, ground: true });
  const [stats, setStats] = useState({ nodes: 0, pipes: 0, scs: 0 });
  const [vertEx, setVertEx] = useState(5);

  // Dynamic state
  const [dynI, setDynI] = useState(80);
  const draggedRainRef = useRef(false); // 用户是否曾拖动过雨强滑条(引导第 3 步完成条件)
  // 管道调节阀:已生效开度(pipeId→0-1)与拖动中预览;防抖重跑(与雨强滑条同模式)
  const [valves, setValves] = useState<Record<string, number>>({});
  const [valveDraft, setValveDraft] = useState<Record<string, number>>({});
  const valveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valvesRef = useRef<Record<string, number>>({});
  useEffect(() => { valvesRef.current = valves; }, [valves]);
  // 蓄水设施 state(声明须在着色 effect 之前)
  interface StorageFac { id: string; nodeId: string; capacity: number }
  const [storages, setStorages] = useState<StorageFac[]>([]);
  const [placingStorage, setPlacingStorage] = useState(false);
  const [storageSel, setStorageSel] = useState<string | null>(null);
  const placingRef = useRef(false);
  const storageSelRef = useRef<string | null>(null);
  useEffect(() => { placingRef.current = placingStorage; }, [placingStorage]);
  useEffect(() => { storageSelRef.current = storageSel; }, [storageSel]);
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
  const [compareRes, setCompareRes] = useState<Record<string, any> | null>(null);
  const [comparing, setComparing] = useState(false);
  const [dynStep, setDynStep] = useState(0);
  const [dynPlay, setDynPlay] = useState(false);
  const [dynSpd, setDynSpd] = useState(1);
  const [dynPhase, setDynPhase] = useState<"config"|"loading"|"ready"|"running"|"paused"|"done">("config");
  const [simId, setSimId] = useState("");
  const [heatmap, setHeatmap] = useState(false);
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
        // 放置/移动蓄水池模式:点击任意地面位置 → 吸附最近节点
        if (placingRef.current || storageSelRef.current) {
          const gp = groundPoint(nx, ny);
          if (gp) { placeStorage(gp.x, gp.z); return; }
        }
        const obj = pick(nx, ny);
        if (obj) {
          // 点击蓄水池:选中(显示容量/删除控制),不干扰管道选中
          if (obj.userData?.storage) {
            setStorageSel(obj.userData.storageId as string);
            if (selRef.current) { resetHL(selRef.current); selRef.current = null; setSelected(null); }
            return;
          }
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

  function hlObj(obj: THREE.Object3D) {
    obj.traverse(c => { if (c instanceof THREE.Mesh && c.material && !(c.material as any)._isWater) { (c.material as any).emissive = new THREE.Color(HIGHLIGHT_EMI); (c.material as any).emissiveIntensity = 0.5; } });
  }
  function resetHL(obj: THREE.Object3D) {
    obj.traverse(c => { if (c instanceof THREE.Mesh && c.material && !(c.material as any)._isWater) { (c.material as any).emissive = new THREE.Color("#000000"); (c.material as any).emissiveIntensity = 0; } });
  }

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
  const loadSim = useCallback(async (overrideIntensity?: number, overrideLandcover?: "default" | "gray" | "green", overrideValves?: Record<string, number>, overrideStorages?: Array<{ nodeId: string; capacity: number }>) => {
    const reqSeq = ++simSeqRef.current;
    // 取消待执行的雨强防抖重跑(避免旧闭包竞态覆盖新方案状态)
    if (rainTimer.current) { clearTimeout(rainTimer.current); rainTimer.current = null; }
    setRainPreview(null);
    setDynPhase("loading"); setDynStep(0);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const simIntensity = overrideIntensity ?? dynI;
    const simLandcover = overrideLandcover ?? landcover;
    const simValves = overrideValves ?? valves;
    const simStorages = overrideStorages ?? storagesRef.current.map(s => ({ nodeId: s.nodeId, capacity: s.capacity }));
    let tid: ReturnType<typeof setTimeout> | null = null;
    try {
      tid = setTimeout(() => ctrl.abort(), 90000);
      const res = await fetch("/api/swmm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ intensity: simIntensity, landcover: simLandcover, valves: Object.keys(simValves).length ? simValves : undefined, storages: simStorages.length ? simStorages : undefined }), signal: ctrl.signal });
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
          // 高亮交给着色 effect 统一应用(存 ref,until 后自然过期,不再被重着色覆盖)
          if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
          highlightRef.current = { top, until: Date.now() + 5000 };
          // 过期时强制清除高亮(推演静止时 effect 不再重跑,高亮不会残留);有流量的管道按 effect 公式恢复流量色,不覆盖着色
          highlightTimerRef.current = setTimeout(() => {
            highlightRef.current = null;
            highlightTimerRef.current = null;
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
  }, [dynI, landcover, valves]);

  // 三方案对比:串行仿真 现状/绿色/灰色(后端为同步仿真,逐个请求),展示峰值差异
  const runCompare = useCallback(async () => {
    if (comparing) return;
    const seq = ++simSeqRef.current;
    // 取消待执行的雨强防抖重跑(避免防抖回调抢占对比请求)
    if (rainTimer.current) { clearTimeout(rainTimer.current); rainTimer.current = null; }
    setRainPreview(null);
    abortRef.current?.abort();
    setComparing(true); setCompareRes(null); setDynPhase("loading"); setDynStep(0);
    const results: Record<string, any> = {};
    const schemes: Array<["default" | "green" | "gray", string]> = [["default", "现状"], ["green", "绿色海绵"], ["gray", "灰色强开发"]];
    let tid: ReturnType<typeof setTimeout> | null = null;
    try {
      for (const [lc, label] of schemes) {
        if (seq !== simSeqRef.current) return;
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        tid = setTimeout(() => ctrl.abort(), 90000);
        const res = await fetch("/api/swmm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ intensity: dynI, landcover: lc }), signal: ctrl.signal });
        if (tid) { clearTimeout(tid); tid = null; }
        if (abortRef.current === ctrl) abortRef.current = null;
        const d = await res.json();
        if (!d.ok) throw new Error(`${label}方案: ${d.error || "API error"}`);
        results[lc] = d;
      }
      if (seq !== simSeqRef.current) return;
      setCompareRes(results);
      setDynRes(results.default); setSimId(results.default.simulationId || ""); setDynPhase("ready");
    } catch (e: any) { if (seq !== simSeqRef.current) return; setDynPhase("config"); if (e.name !== "AbortError") alert("对比仿真失败: " + e.message); }
    finally { if (tid) clearTimeout(tid); setComparing(false); }
  }, [dynI, comparing]);

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
      childrenToRemove.forEach(c => { group.remove(c); const m = c as THREE.Mesh; if (m.geometry && m.geometry !== SHARED.heatDisc && m.geometry !== SHARED.overflowRing) m.geometry.dispose(); const mat = m.material as THREE.Material | undefined; if (mat) mat.dispose(); });
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

      // 淹没热力图:按深度比例着色的半透明圆盘(蓝绿→黄→红紫)(清理已统一在 early-return 前)
      if (heatmap && depth > 0.02) {
        const maxD = ts.summary?.maxDepth?.value || 1;
        const ratio = Math.min(1, depth / Math.max(0.05, maxD));
        const ringGeom = SHARED.heatDisc; // 共享几何
        const hue = 0.62 - ratio * 0.62; // 蓝(0.62)→红(0)
        const ring = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue, 0.85, 0.55), transparent: true, opacity: 0.28 + ratio * 0.3, depthWrite: false }));
        ring.position.y = groundY + 0.01; ring.rotation.x = -Math.PI / 2; (ring as any).userData = { overflowRing: true };
        group.add(ring);
      }
      if (ponding > 0.01) {
        // 溢流积水圆盘:半径/透明度随地表积水体积实时涨(灾情可视化)
        const pGeom = new THREE.CircleGeometry(Math.min(1.6, 0.35 + ponding * 0.08), 20);
        const pDisc = new THREE.Mesh(pGeom, new THREE.MeshBasicMaterial({ color: "#3aa0ff", transparent: true, opacity: Math.min(0.45, 0.15 + ponding * 0.02), depthWrite: false }));
        pDisc.position.y = groundY + 0.015; pDisc.rotation.x = -Math.PI / 2; (pDisc as any).userData = { overflowRing: true };
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
      if (absFlow < 0.0005) { mat.color.set(PIPE_COLOR); mat.emissive.set(PIPE_EMISSIVE); mat.emissiveIntensity = 0.08; }
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

    // 蓄水设施 3D:半透明青色罐体(挂在最近节点)+ 内部水位随节点水深涨落;选中罐体白亮
    const nodesById = new Map((dataRef.current?.nodes as any[])?.map((n: any) => [n.id, n]) || []);
    const seenSt = new Set<string>();
    storages.forEach(fac => {
      const n = nodesById.get(fac.nodeId);
      if (!n) return;
      seenSt.add(fac.id);
      let g = storageMeshMap.current.get(fac.id);
      if (!g) {
        const tank = new THREE.Mesh(SHARED.storageTank, new THREE.MeshStandardMaterial({ color: "#2bd4c8", transparent: true, opacity: 0.35, roughness: 0.2, metalness: 0.1, emissive: "#0a4a46", emissiveIntensity: 0.3 }));
        tank.position.y = 0.72;
        const water = new THREE.Mesh(SHARED.storageWater, new THREE.MeshStandardMaterial({ color: "#2a9dd8", transparent: true, opacity: 0.85, roughness: 0.1, metalness: 0.05 }));
        (water.material as any)._isWater = true;
        water.position.y = 0.1; water.scale.y = 0.001;
        const grp = new THREE.Group();
        grp.add(tank); grp.add(water);
        grp.position.set(n.x, 0, n.z);
        (grp as any).userData = { storage: true, storageId: fac.id };
        sceneRef.current?.add(grp);
        g = { grp, tank, water }; storageMeshMap.current.set(fac.id, g);
      }
      g.grp.position.set(n.x, 0, n.z);
      // 水位:节点当前水深相对最大水深(罐内 0.1-1.25m)
      const nd = (dynRes as any)?.nodes?.[fac.nodeId];
      const depth = nd?.depth?.[dynStep] ?? 0;
      const maxD = (dynRes as any)?.summary?.maxDepth?.value || 1;
      const lvl = Math.max(0.001, Math.min(1, (depth / Math.max(0.05, maxD)) * 1.1));
      g.water.scale.y = lvl; g.water.position.y = 0.1 + (1.15 * lvl) / 2;
      // 选中白亮
      const tankMat = g.tank.material as THREE.MeshStandardMaterial;
      tankMat.emissiveIntensity = storageSel === fac.id ? 0.9 : 0.3;
      tankMat.opacity = storageSel === fac.id ? 0.6 : 0.35;
    });
    // 移除已删除蓄水池的 3D 对象(仅 dispose 实例材质,共享几何由 SHARED 统一管理)
    for (const [id, g] of storageMeshMap.current) {
      if (!seenSt.has(id)) {
        sceneRef.current?.remove(g.grp);
        (g.tank.material as THREE.Material).dispose();
        (g.water.material as THREE.Material).dispose();
        storageMeshMap.current.delete(id);
      }
    }
  }, [dynStep, dynRes, vertEx, heatmap, selected, rainPreview, valves, valveDraft, storages, storageSel]);

  useEffect(() => { if (mode !== "dynamic") clearWaterMeshes(); }, [mode, clearWaterMeshes]);

  // 首次进入动态模式:分步引导(guide)优先,旧版一次性气泡兜底
  useEffect(() => {
    if (mode !== "dynamic") return;
    try {
      if (!localStorage.getItem("sandbox-guide-v1")) {
        localStorage.setItem("sandbox-guide-v1", "1");
        setGuide(1);
      } else if (!localStorage.getItem("sandbox-tip-v1")) {
        localStorage.setItem("sandbox-tip-v1", "1");
        setShowTip(true);
        setTimeout(() => setShowTip(false), 9000);
      }
    } catch { /* 隐私模式忽略 */ }
  }, [mode]);

  // 分步引导步进:完成当前步骤动作后自动进入下一步
  useEffect(() => {
    if (!guide) return;
    if (guide === 1 && selected?.type === "pipe") setGuide(2);
    else if (guide === 2 && landcover !== "default") setGuide(3);
    else if (guide === 3 && draggedRainRef.current) { setGuide(0); }
  }, [guide, selected, landcover, dynI]);
  const finishGuide = () => { setGuide(0); };
  // 引导完成后一次性提示动手玩法(仅首次)
  useEffect(() => {
    if (guide === 0) {
      try {
        if (!localStorage.getItem("sandbox-hands-v1")) {
          localStorage.setItem("sandbox-hands-v1", "1");
          setSchemeMsg({ text: "💡 试试:点击管道调🚰调节阀 · 点「🪣 放蓄水池」削峰", color: "text-teal-300" });
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
  const onValveChange = (pid: string, v: number) => {
    const k = Math.max(0, Math.min(1, v / 100));
    setValveDraft(d => ({ ...d, [pid]: k }));
    if (valveTimerRef.current) { clearTimeout(valveTimerRef.current); valveTimerRef.current = null; }
    valveTimerRef.current = setTimeout(() => {
      const nv = { ...valvesRef.current, [pid]: k };
      valvesRef.current = nv;
      setValves(nv);
      setValveDraft(d => { const n = { ...d }; delete n[pid]; return n; });
      loadSim(undefined, undefined, nv);
    }, 500);
  };
  const resetValves = (pid?: string) => {
    if (valveTimerRef.current) { clearTimeout(valveTimerRef.current); valveTimerRef.current = null; }
    const nv = { ...valvesRef.current };
    if (pid) delete nv[pid]; else for (const k of Object.keys(nv)) delete nv[k];
    valvesRef.current = nv;
    setValves(nv);
    setValveDraft({});
    loadSim(undefined, undefined, nv);
  };

  // ─── 蓄水设施:放置/选中/移动/容量/删除(改造节点洼地面积 Aponded,削峰) ───
  const storagesRef = useRef<StorageFac[]>([]);
  useEffect(() => { storagesRef.current = storages; }, [storages]);
  const nearestNodeId = (x: number, z: number): string | null => {
    const nodes = (dataRef.current?.nodes as any[]) || [];
    let best: string | null = null, bd = Infinity;
    for (const n of nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n.id; } }
    return best;
  };
  const placeStorage = (x: number, z: number, nodeId?: string) => {
    const nid = nodeId || nearestNodeId(x, z);
    if (!nid) return;
    const existing = storageSelRef.current ? storagesRef.current.find(s => s.id === storageSelRef.current) : null;
    if (existing) {
      // 移动选中蓄水池到新节点
      const next = storagesRef.current.map(s => s.id === existing.id ? { ...s, nodeId: nid } : s);
      storagesRef.current = next; setStorages(next);
    } else {
      const fac: StorageFac = { id: `st-${Date.now().toString(36)}`, nodeId: nid, capacity: 500 };
      storagesRef.current = [...storagesRef.current, fac]; setStorages(storagesRef.current);
    }
    setStorageSel(existing ? existing.id : storageSelRef.current);
    if (placingRef.current) setPlacingStorage(false);
    loadSim(undefined, undefined, undefined, storagesRef.current);
  };
  const changeStorageCapacity = (id: string, cap: number) => {
    const next = storagesRef.current.map(s => s.id === id ? { ...s, capacity: cap } : s);
    storagesRef.current = next; setStorages(next);
    if (storageCapTimerRef.current) { clearTimeout(storageCapTimerRef.current); storageCapTimerRef.current = null; }
    storageCapTimerRef.current = setTimeout(() => loadSim(undefined, undefined, undefined, storagesRef.current), 500);
  };
  const removeStorage = (id: string) => {
    storagesRef.current = storagesRef.current.filter(s => s.id !== id); setStorages(storagesRef.current);
    if (storageSel === id) setStorageSel(null);
    loadSim(undefined, undefined, undefined, storagesRef.current);
  };
  const storageCapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载清理防抖/提示定时器(防卸载后 setState/fetch)
  useEffect(() => () => {
    if (rainTimer.current) clearTimeout(rainTimer.current);
    if (schemeMsgTimer.current) clearTimeout(schemeMsgTimer.current);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    if (traceTimerRef.current) clearTimeout(traceTimerRef.current);
    if (valveTimerRef.current) clearTimeout(valveTimerRef.current);
    if (storageCapTimerRef.current) clearTimeout(storageCapTimerRef.current);
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

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-black relative">
      {/* ── Top bar ── */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-black/92 backdrop-blur border-b border-gray-800 px-2 py-1 flex items-center gap-2 text-[11px] flex-wrap">
        <span className="font-bold text-gray-300 text-xs">🌊 紫荆雅园</span>
        <div className="flex bg-gray-800 rounded-lg p-0.5">
          <button onClick={() => { setMode("static"); clearWaterMeshes(); }} className={"px-3 py-1 rounded-md font-bold text-xs " + (mode === "static" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white")}>📐 静态沙盘</button>
          <button onClick={() => setMode("dynamic")} className={"px-3 py-1 rounded-md font-bold text-xs " + (mode === "dynamic" ? "bg-cyan-600 text-white" : "text-gray-400 hover:text-white")}>▶ 动态推演</button>
        </div>
        <div className="h-4 w-px bg-gray-600" />
        <button onClick={() => setHeatmap(v => !v)} title="节点淹没深度热力图" className={"px-2 py-1 rounded-md text-xs font-bold " + (heatmap ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white")}>🌡 热力图</button>
        <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")} title="切换深浅主题" className={"px-2 py-1 rounded-md text-xs font-bold " + (theme === "light" ? "bg-amber-500 text-black" : "text-gray-400 hover:text-white")}>{theme === "dark" ? "☀️ 浅色" : "🌙 深色"}</button>
        <button onClick={() => setOrbit(v => !v)} title="相机自动环绕" className={"px-2 py-1 rounded-md text-xs font-bold " + (orbit ? "bg-pink-600 text-white" : "text-gray-400 hover:text-white")}>🔄 环绕</button>
        <div className="h-4 w-px bg-gray-600" />
        {[{ id: "sc", l: "汇水区" },{ id: "pipes", l: "管道" },{ id: "nodes", l: "节点" },{ id: "ground", l: "地表" }].map(({ id, l }) => (
          <button key={id} onClick={() => toggleLayer(id)} className={"px-1.5 py-0.5 rounded text-[10px] " + (layers[id] ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-500")}>{l}</button>
        ))}
        <div className="h-4 w-px bg-gray-600" />
        {[{ v: "panorama", l: "全景" },{ v: "topdown", l: "俯视" },{ v: "underground", l: "地下" }].map(({ v, l }) => (
          <button key={v} onClick={() => flyTo(v)} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300">{l}</button>
        ))}
        <div className="h-4 w-px bg-gray-600" />
        <span className="text-gray-500 text-[10px]">垂直:</span>
        {[1,3,5,8].map(v => (<button key={v} onClick={() => { setVertEx(v); rebuild(v); }} className={"px-1 py-0.5 rounded text-[10px] " + (vertEx===v ? "bg-blue-700" : "bg-gray-800 text-gray-400")}>{v}×</button>))}
        <span className="ml-auto text-[9px] text-gray-500">{stats.nodes}节点 · {stats.pipes}管 · {stats.scs}汇水区</span>
      </div>

      {/* ── Three.js canvas ── */}
      <div ref={cr} className="flex-1" />

      {/* ── STATIC property panel — all Chinese ── */}
      {mode === "static" && selected && (
        <div className="absolute right-2 top-14 bg-black/90 backdrop-blur rounded-lg border border-gray-700 p-2.5 text-white text-[11px] z-10 w-52 max-h-[80vh] overflow-y-auto">
          <div className="font-bold text-gray-300 mb-1.5 text-xs flex justify-between">
            <span>{{ node: "🔹 节点", pipe: "▬ 管道", subcatchment: "▨ 汇水区" }[selected.type as string] || selected.type}</span>
            <button onClick={() => { if (selRef.current) resetHL(selRef.current); selRef.current = null; setSelected(null); }} className="text-gray-500 hover:text-gray-300 text-[10px]">✕</button>
          </div>
          <div className="space-y-0.5">
            {Object.entries(selected.data).map(([k, v]: [string, any]) => (
              <div key={k} className="flex justify-between">
                <span className="text-gray-500">{chineseLabel(k)}</span>
                <span className="text-gray-200 text-right ml-2">{k === "type" ? chineseType(String(v)) : formatVal(k, v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DYNAMIC panel ── */}
      {mode === "dynamic" && (
        <div className="absolute right-2 top-14 bg-black/90 backdrop-blur rounded-lg border border-gray-700 p-2.5 text-white text-[11px] z-10 w-52 max-h-[80vh] overflow-y-auto">
          <div className="font-bold text-gray-300 mb-2 text-xs">
            {{ config: "⚙️ 场景配置", loading: "⏳ 加载中…", ready: "📊 就绪", running: "🔵 运行中", paused: "⏸ 暂停", done: "✅ 完成" }[dynPhase]}
            {selected && (<button onClick={() => { if (selRef.current) resetHL(selRef.current); selRef.current = null; setSelected(null); }} className="float-right text-gray-500 text-[10px]">✕</button>)}
          </div>

          {(dynPhase === "config" || dynPhase === "ready" || dynPhase === "done") && (
            <div className="space-y-2">
              <div className={guide === 3 ? "rounded-lg ring-2 ring-yellow-400/80 p-1" : ""}><div className="flex justify-between text-[10px]"><span className="text-gray-500">降雨倍率</span><span className="text-cyan-400 font-bold">{rainPreview ?? dynI}%{rainPreview != null && <span className="text-yellow-400 ml-1">预览</span>}</span></div>
              <input type="range" min="10" max="300" value={rainPreview ?? dynI}
                onChange={e => {
                  const v = +e.target.value;
                  setRainPreview(v); // 拖动中:仅视觉预览,横截面水位按比例缩放
                  if (rainTimer.current) clearTimeout(rainTimer.current);
                  rainTimer.current = setTimeout(() => { // 松手 500ms 防抖后真实仿真
                    setRainPreview(null);
                    if (v !== dynI) { draggedRainRef.current = true; setDynI(v); loadSim(v); } else { setDynPhase("config"); if (dynRes) setDynRes(null); }
                  }, 500);
                }} className="w-full accent-cyan-500 mt-0.5 h-1.5" /></div>
              {/* 暴雨情景预设:一键设置重现期并仿真 */}
              <div>
                <div className="mb-1 text-[10px] text-gray-500">暴雨情景</div>
                <div className="grid grid-cols-3 gap-1">
                  {([["5年一遇", 120], ["10年一遇", 160], ["50年一遇", 240]] as const).map(([label, pct]) => (
                    <button key={label} onClick={() => { setDynI(pct); loadSim(pct); }} title={`${label}（降雨倍率 ${pct}%）`} className={`py-1 rounded text-[10px] font-bold transition-colors ${dynI === pct ? "bg-blue-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>{label}</button>
                  ))}
                </div>
              </div>
              {/* 下垫面方案切换(方案2):点击改变下垫面→重新仿真→横截面水量变化 */}
              <div className={guide === 2 ? "rounded-lg ring-2 ring-yellow-400/80 p-1" : ""}>
                <div className="mb-1 text-[10px] text-gray-500">下垫面方案</div>
                <div className="grid grid-cols-3 gap-1">
                  {([["default", "⚪ 现状"], ["green", "🟢 绿色海绵"], ["gray", "🟠 灰色强开发"]] as const).map(([val, label]) => (
                    <button key={val} onClick={() => { if (val === landcover) return; setLandcover(val); setRainPreview(null); loadSim(undefined, val); }} className={`py-1 rounded text-[10px] font-bold transition-colors ${landcover === val ? (val === "green" ? "bg-green-700 text-white" : val === "gray" ? "bg-orange-700 text-white" : "bg-gray-600 text-white") : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>{label}</button>
                  ))}
                </div>
                {landcover !== "default" && <div className="mt-1 text-[9px] leading-3.5 text-gray-500">{landcover === "green" ? "增加透水铺装与绿地,降低不透水率" : "增加硬化地面,提高不透水率"}</div>}
              </div>
              <button onClick={() => loadSim()} className="w-full py-1.5 bg-cyan-800 rounded font-bold text-xs hover:bg-cyan-700 transition-colors">{dynRes ? "🔄 重新仿真" : "📊 加载仿真结果"}</button>
              <button onClick={() => setPlacingStorage(v => !v)} className={`w-full py-1 rounded text-[10px] font-bold transition-colors ${placingStorage ? "bg-teal-600 text-white ring-1 ring-teal-300" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>🪣 {placingStorage ? "点击地面放置蓄水池…" : `放蓄水池(${storages.length})`}</button>
              {Object.keys(valves).length > 0 && <button onClick={() => resetValves()} className="w-full py-1 bg-purple-900/70 rounded text-[10px] font-bold hover:bg-purple-800/70 transition-colors">♻ 重置全部阀门({Object.keys(valves).length})</button>}
              {storageSel && (() => { const fac = storages.find(s => s.id === storageSel); if (!fac) return null; return (
                <div className="rounded bg-teal-950/50 border border-teal-800/70 p-1.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-teal-300">🪣 蓄水池 @ {fac.nodeId}</span>
                    <button onClick={() => removeStorage(fac.id)} className="text-[9px] text-red-400 hover:text-red-300">🗑 删除</button>
                  </div>
                  <input type="range" min="50" max="5000" step="50" value={fac.capacity} onChange={e => changeStorageCapacity(fac.id, Number(e.target.value))} className="w-full accent-teal-400" />
                  <div className="flex justify-between text-[9px] text-gray-500"><span>容量</span><span className="text-teal-300 font-bold">{fac.capacity} m³</span></div>
                  <div className="text-[9px] leading-3 text-teal-400/80">点击其他位置可移动(吸附最近节点)· 容量越大削峰越明显</div>
                </div>
              ); })()}
              <button onClick={runCompare} disabled={comparing} className="w-full py-1.5 bg-violet-900 rounded font-bold text-xs hover:bg-violet-800 transition-colors disabled:opacity-40">{comparing ? "⏳ 对比中…" : "⚖️ 三方案对比"}</button>
              {compareRes && (
                <div className="border-t border-gray-700 pt-1.5 mt-1 space-y-1">
                  <div className="text-[10px] text-gray-500">降雨 {dynI}% · 峰值流量对比</div>
                  <div className="grid grid-cols-3 gap-1">
                    {([["default", "现状", "text-gray-300"], ["green", "绿色", "text-green-400"], ["gray", "灰色", "text-orange-400"]] as const).map(([lc, label, color]) => {
                      const v = compareRes[lc]?.summary?.maxFlow?.value;
                      const base = compareRes.default?.summary?.maxFlow?.value;
                      const diff = (v != null && base > 0) ? ((v - base) / base) * 100 : 0;
                      return (
                        <button key={lc} onClick={() => {
                          // 峰值卡片一键跳转:载入该方案结果并跳到全局峰值时刻(3D/横截面/时间轴同步)
                          const rs = compareRes[lc];
                          if (!rs) return;
                          // 竞态防护:作废在途 loadSim/对比请求与雨强防抖
                          simSeqRef.current++;
                          abortRef.current?.abort();
                          if (rainTimer.current) { clearTimeout(rainTimer.current); rainTimer.current = null; }
                          setRainPreview(null);
                          setLandcover(lc);
                          prevSimRef.current = dynRes; // 供 Δ 对比提示
                          setDynRes(rs); setSimId(rs.simulationId || ""); setDynPhase("ready");
                          let pk = 0, pkv = -1;
                          Object.values(rs.links || {}).forEach((ld: any) => (ld?.flow || []).forEach((f: number, i: number) => { if (Math.abs(f) > pkv) { pkv = Math.abs(f); pk = i; } }));
                          setDynStep(pk);
                          setDynPlay(false);
                        }} title="点击跳转到该方案的峰值时刻" className="rounded bg-gray-800/80 p-1.5 text-center hover:bg-gray-700/80 transition-colors cursor-pointer">
                          <div className={`text-[9px] ${color}`}>{label}</div>
                          <div className="text-[10px] font-bold text-gray-100">{v != null ? v.toFixed(2) : "—"}</div>
                          {lc !== "default" && <div className={`text-[9px] font-bold ${diff <= 0 ? "text-green-400" : "text-orange-400"}`}>{diff <= 0 ? "▼" : "▲"}{Math.abs(diff).toFixed(0)}%</div>}
                          {lc === "default" && <div className="text-[9px] text-gray-500">基准</div>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-[9px] leading-3 text-gray-500">绿色海绵降低峰值 {(() => { const g = compareRes.green?.summary?.maxFlow?.value, b = compareRes.default?.summary?.maxFlow?.value; return (g != null && b > 0) ? Math.max(0, ((b - g) / b) * 100).toFixed(0) : "—"; })()}%，灰色强开发抬高峰值 {(() => { const r = compareRes.gray?.summary?.maxFlow?.value, b = compareRes.default?.summary?.maxFlow?.value; return (r != null && b > 0) ? Math.max(0, ((r - b) / b) * 100).toFixed(0) : "—"; })()}%</div>
                </div>
              )}
              {dynPhase === "ready" && <button onClick={() => { setDynPhase("running"); setDynPlay(true); setDynStep(0); }} className="w-full py-1.5 bg-green-800 rounded font-bold text-xs hover:bg-green-700">▶ 开始推演</button>}
              {dynPhase === "done" && <button onClick={() => { setDynStep(0); setDynPlay(true); setDynPhase("running"); }} className="w-full py-1.5 bg-green-800 rounded font-bold text-xs hover:bg-green-700">🔄 重新推演</button>}
              {dynRes && (<div className="border-t border-gray-700 pt-1.5 mt-1 space-y-0.5 text-[10px]">
                {simId && <div className="text-gray-600 truncate" title={simId}>ID: {simId.slice(0,8)}…</div>}
                <div className="flex justify-between"><span className="text-gray-500">时间步</span><span className="text-gray-300">{dynRes.timeStepCount}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">最大水深</span><span className="text-gray-300">{dynRes.summary?.maxDepth?.value?.toFixed(2)} m</span></div>
                <div className="flex justify-between"><span className="text-gray-500">最大流量</span><span className="text-gray-300">{dynRes.summary?.maxFlow?.value?.toFixed(2)} m³/s</span></div>
                <div className="flex justify-between"><span className="text-gray-500">活跃</span><span className="text-gray-300">{dynRes.summary?.activeNodes}n / {dynRes.summary?.activeLinks}l</span></div>
                {riskStats && (riskStats.fullPipes.length > 0 || riskStats.overflowNodes.length > 0) && (
                  <div className="mt-1 rounded bg-red-950/50 border border-red-900/60 p-1.5 space-y-0.5">
                    <div className="text-[10px] font-bold text-red-400">⚠️ 当前风险</div>
                    {riskStats.fullPipes.length > 0 && <div className="flex justify-between"><span className="text-red-300/80">满管管道</span><span className="text-red-300 font-bold">{riskStats.fullPipes.length} 条</span></div>}
                    {riskStats.overflowNodes.length > 0 && <div className="flex justify-between"><span className="text-red-300/80">溢流节点</span><span className="text-red-300 font-bold">{riskStats.overflowNodes.length} 个</span></div>}
                    <div className="text-[9px] leading-3 text-red-400/70">满管: {riskStats.fullPipes.slice(0, 5).join(", ")}{riskStats.fullPipes.length > 5 ? ` 等${riskStats.fullPipes.length}条` : ""} · 溢流: {riskStats.overflowNodes.slice(0, 5).join(", ")}{riskStats.overflowNodes.length > 5 ? ` 等${riskStats.overflowNodes.length}个` : ""}</div>
                  </div>
                )}
                {(Object.keys(valves).length > 0 || storages.length > 0) && (
                  <div className="flex justify-between"><span className="text-gray-500">动手改造</span><span className="text-gray-300">🚰 阀门 {Object.keys(valves).length} · 🪣 蓄水 {storages.length}</span></div>
                )}
              </div>)}
            </div>
          )}

          {dynPhase === "running" && (
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-gray-500">当前时间</span><span className="text-gray-200 font-bold font-mono">{currentTimeLabel}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">当前步</span><span className="text-gray-200">{dynStep+1}/{timeStepCount}</span></div>
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

          {/* 管网横截面:默认展示当前最满管道(不用先点管道);选中管道时由下方区块接管 */}
          {!selected && autoPipeId && dynRes?.links?.[autoPipeId] && (dynPhase === "running" || dynPhase === "paused" || dynPhase === "done") && (() => {
            const ld = dynRes.links[autoPipeId] as any;
            const pp = (dataRef.current?.pipes as any)?.find?.((p: any) => p.id === autoPipeId);
            return (
            <div className="border-t border-gray-700 mt-2 pt-1.5">
              <div className="flex items-center justify-between mb-1">
                <div className="font-bold text-xs text-gray-300">▬ {autoPipeId}<span className="ml-1 text-[9px] font-normal text-cyan-400">当前最满</span></div>
                <span className="text-[9px] text-gray-500">点击其他管道切换</span>
              </div>
              <PipeCrossSection
                diam={pp?.diam || 0.3}
                depth={ld.depth?.[dynStep] ?? 0}
                depthFraction={ld.depthFraction?.[dynStep] ?? 0}
                flow={ld.flow?.[dynStep] ?? 0}
                flowDir={`${pp?.from ?? "?"} → ${pp?.to ?? "?"}`}
                landcover={landcover}
                previewRatio={(rainPreview != null ? Math.max(0.05, rainPreview / simIBaseRef.current) : 1) * valveRatio(autoPipeId)}
              />
            </div>
            );
          })()}

          {/* Dynamic property for selected object */}
          {selected && (dynPhase === "running" || dynPhase === "paused" || dynPhase === "done") && (
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
                <div className="flex justify-between"><span className="text-gray-500">capacity</span><span className="text-gray-200">{(curLinkData.capacity?.[dynStep]??0).toFixed(3)}</span></div>
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
                  previewRatio={(rainPreview != null ? Math.max(0.05, rainPreview / simIBaseRef.current) : 1) * valveRatio(selected.data.id)}
                />
                {/* 调节阀控制(动手型交互):拖动即时预览横截面,松手防抖后重跑仿真 */}
                <div className="mt-1.5 rounded bg-purple-950/40 border border-purple-900/60 p-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-purple-300">🚰 调节阀</span>
                    {(valves[selected.data.id] != null || valveDraft[selected.data.id] != null) && <button onClick={() => resetValves(selected.data.id)} className="text-[9px] text-purple-400 hover:text-purple-200">重置</button>}
                  </div>
                  <input type="range" min="0" max="100" step="5" value={Math.round((valveDraft[selected.data.id] ?? valves[selected.data.id] ?? 1) * 100)} onChange={e => onValveChange(selected.data.id, Number(e.target.value))} className="w-full accent-purple-500" />
                  <div className="flex justify-between text-[9px] text-gray-500"><span>关闭</span><span className="text-purple-300 font-bold">{Math.round((valveDraft[selected.data.id] ?? valves[selected.data.id] ?? 1) * 100)}%</span><span>全开</span></div>
                  {(valves[selected.data.id] != null && valveDraft[selected.data.id] == null) && <div className="text-[9px] leading-3 text-purple-400/80 mt-0.5">已生效,拖动调整后松手重新仿真</div>}
                </div>
              </>)}
            </div>
          )}
        </div>
      )}

      {/* ── Time-series charts (dynamic + selected object + 三方案对比) ── */}
      {mode === "dynamic" && dynRes?.ok && timeStepCount > 0 && (selected || compareRes) && (
        <ChartPanel
          selected={selected}
          dynRes={dynRes}
          dynStep={dynStep}
          timeStepCount={timeStepCount}
          currentTimeLabel={currentTimeLabel}
          compareRes={compareRes}
          onSeek={(step) => { setDynStep(step); setDynPlay(false); setDynPhase("paused"); }}
        />
      )}

      {/* ── Timeline (dynamic only) ── */}
      {/* 三方案横截面对比浮层(独立于窄面板,并排不溢出) */}
      {mode === "dynamic" && compareRes && (() => {
        const cmpPipe = (selected?.type === "pipe" ? selected.data.id : null) || autoPipeId;
        if (!cmpPipe || !compareRes.default?.links?.[cmpPipe]) return null;
        const cmpDiam = selected?.type === "pipe" ? (selected.data.diam || 0.3) : ((dataRef.current?.pipes as any)?.find?.((p: any) => p.id === cmpPipe)?.diam) || 0.3;
        const peakOf = (rs: any) => { const flows = rs?.links?.[cmpPipe]?.flow || []; let pk = 0; flows.forEach((v: number, i: number) => { if (Math.abs(v) > Math.abs(flows[pk] ?? 0)) pk = i; }); return pk; };
        const pkDefault = peakOf(compareRes.default);
        const bv = Math.abs(compareRes.default.links[cmpPipe].flow?.[pkDefault] ?? 0);
        return (
          <div className="absolute left-2 bottom-14 z-10 bg-black/90 backdrop-blur rounded-lg border border-gray-700 p-2 w-[340px] shadow-lg">
            <div className="text-[10px] text-gray-400 mb-1">▬ {cmpPipe} 三方案横截面对比(峰值时刻)</div>
            <div className="flex gap-1">
              {([["default", "⚪现状", "text-gray-400"], ["green", "🟢绿色", "text-green-400"], ["gray", "🟠灰色", "text-orange-400"]] as const).map(([lc, label, color]) => {
                const rs = compareRes[lc]; const ld = rs?.links?.[cmpPipe]; if (!ld) return null;
                const pk = peakOf(rs); const f = ld.flow?.[pk] ?? 0;
                const diff = bv > 0 ? (Math.abs(f) - bv) / bv * 100 : 0;
                return (
                  <div key={lc} className="flex-1 text-center">
                    <PipeCrossSection
                      diam={cmpDiam}
                      depth={ld.depth?.[pk] ?? 0}
                      depthFraction={ld.depthFraction?.[pk] ?? 0}
                      flow={f}
                      flowDir={label}
                      landcover={lc}
                      animate={false}
                      compact
                    />
                    <div className={`text-[9px] font-bold ${lc === "default" ? "text-gray-500" : diff <= 0 ? "text-green-400" : "text-orange-400"}`}>{lc === "default" ? "基准" : `${diff <= 0 ? "▼" : "▲"}${Math.abs(diff).toFixed(0)}%`}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      {/* 方案切换结果状态条 */}
      {schemeMsg && mode === "dynamic" && (
        <div className={`absolute bottom-14 left-1/2 -translate-x-1/2 z-10 bg-black/85 border border-gray-700 rounded-lg px-3 py-1.5 text-[11px] font-bold whitespace-nowrap shadow-lg ${schemeMsg.color}`}>{schemeMsg.text}</div>
      )}
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
            {guide === 3 && <>③ <b>拖动雨强滑条</b>,观察水位实时预览</>}
          </div>
          <div className="mt-1.5 text-[9px] text-cyan-300/60">{guide === 1 ? "试试点击场景中的管道 →" : guide === 2 ? "试试点右侧方案按钮 →" : "试试拖动滑条 →"}</div>
        </div>
      )}
      {/* 悬停 tooltip(位置由原生 mousemove 直改 style,内容变化才重渲染) */}
      <div ref={tooltipRef} className={`pointer-events-none fixed z-30 bg-black/85 border border-gray-600 rounded-md px-2 py-1 text-[10px] leading-4 text-gray-200 shadow-lg ${hoverInfo ? "" : "hidden"}`} style={{ display: hoverInfo ? undefined : "none" }}>
        {hoverInfo?.lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
      {/* 首次进入引导气泡 */}
      {showTip && mode === "dynamic" && (
        <div className="absolute left-2 top-14 z-10 bg-cyan-950/90 border border-cyan-700 rounded-lg px-3 py-2 text-[11px] text-cyan-100 max-w-xs shadow-lg">
          💡 <b>互动提示:</b>点击管道查看横截面 · 切换下垫面方案对比水量 · 拖动雨强滑条观察水位
          <button onClick={() => setShowTip(false)} className="absolute -top-1.5 -right-1.5 bg-gray-700 hover:bg-gray-600 rounded-full w-4 h-4 text-[9px] leading-4 text-center">✕</button>
        </div>
      )}
      {mode === "dynamic" && dynRes?.ok && (dynPhase === "running" || dynPhase === "paused" || dynPhase === "done") && timeStepCount > 0 && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/92 backdrop-blur border-t border-gray-800 px-4 py-2 z-10">
          {/* 降雨过程条:恒定雨强水平线 + 当前时刻高亮标记(拖动时间轴/推演同步滚动) */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] text-cyan-500 font-bold w-7">🌧 降雨</span>
            <svg className="flex-1 h-5" viewBox="0 0 100 20" preserveAspectRatio="none">
              <line x1="0" y1="10" x2="100" y2="10" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.7" />
              <circle cx={timeStepCount > 1 ? (dynStep / (timeStepCount - 1)) * 100 : 50} cy="10" r="3" fill="#ffd54f" stroke="#1e293b" strokeWidth="0.8" />
            </svg>
            <span className="text-[9px] text-gray-400 font-mono min-w-[3rem] text-right">{dynI}%</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setDynStep(s=>Math.max(0,s-1)); if(dynPlay){setDynPlay(false);setDynPhase("paused");} }} className="text-[10px] bg-gray-800 hover:bg-gray-700 px-1.5 py-1 rounded text-gray-400">◀</button>
            <span className="text-[10px] text-gray-400 font-mono w-12 text-right">{currentTimeLabel}</span>
            <input type="range" min={0} max={timeStepCount-1} value={dynStep} onChange={e => { setDynStep(+e.target.value); if(dynPlay){setDynPlay(false);setDynPhase("paused");} }} className="flex-1 h-2 appearance-none bg-gray-800 rounded-full cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-cyan-600 [&::-webkit-slider-thumb]:rounded-full" />
            <span className="text-gray-400 font-mono text-[10px] min-w-[4rem] text-right">{dynStep+1}/{timeStepCount}</span>
            <button onClick={() => { setDynStep(s=>Math.min(timeStepCount-1,s+1)); if(dynPlay){setDynPlay(false);setDynPhase("paused");} }} className="text-[10px] bg-gray-800 hover:bg-gray-700 px-1.5 py-1 rounded text-gray-400">▶</button>
            <select value={dynSpd} onChange={e=>setDynSpd(+e.target.value)} className="bg-gray-800 rounded px-1.5 py-1 text-[10px] border border-gray-700 text-gray-400"><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={5}>5×</option></select>
            {dynPhase==="running"
              ? <button onClick={()=>{setDynPlay(false);setDynPhase("paused");}} className="bg-yellow-800 hover:bg-yellow-700 px-2 py-1 rounded text-xs font-bold">⏸</button>
              : <button onClick={()=>{if(dynStep>=timeStepCount-1)setDynStep(0);setDynPlay(true);setDynPhase("running");}} className="bg-green-800 hover:bg-green-700 px-2 py-1 rounded text-xs font-bold">▶</button>}
            <span className="hidden text-[9px] text-gray-600 sm:inline">空格 播放/暂停 · ←→ 步进</span>
          </div>
        </div>
      )}

      {!loaded && !error && <div className="absolute inset-0 flex items-center justify-center bg-gray-950 text-white z-20"><span className="animate-spin mr-2">⏳</span>加载 SWMM 模型…</div>}
      {error && <div className="absolute inset-0 flex items-center justify-center bg-gray-950 text-white z-20"><div className="text-center bg-red-900/60 rounded-xl p-6 max-w-md"><div className="text-2xl mb-2">⚠️</div><div className="text-sm mb-1">{error}</div><button onClick={()=>window.location.reload()} className="mt-3 px-4 py-1.5 bg-red-800 rounded text-xs hover:bg-red-700">刷新页面</button></div></div>}
    </div>
  );
}
