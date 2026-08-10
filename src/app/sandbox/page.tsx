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
function PipeCrossSection({ diam, depth, depthFraction, flow, flowDir, landcover }: {
  diam: number; depth: number; depthFraction: number; flow: number; flowDir: string; landcover: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = 180, h = 150;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) / 2 - 16;
    const fillRatio = Math.min(1, Math.max(0, depthFraction || 0));

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

    // 水量(圆管截面:按充满度填充弓形区域)
    if (fillRatio > 0.001) {
      // 水面到圆心的带符号距离:水面在圆心下方为正,上方为负
      // dist = R - 2R*ratio(ratio>0.5 时水面高于圆心,dist 为负)
      const dist = (r - 4) - 2 * (r - 4) * fillRatio;
      const waterY = cy + dist;
      const chordHalf = Math.sqrt(Math.max(0, Math.pow(r - 4, 2) - dist * dist));
      const isFull = fillRatio > 0.985;
      if (isFull) {
        ctx.fillStyle = "rgba(51,136,204,0.85)";
        ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, Math.PI * 2); ctx.fill();
      } else if (chordHalf > 0.01) {
        const halfAngle = Math.acos(Math.min(1, Math.max(-1, dist / (r - 4))));
        // 水面线(弦)两点:与水面同高
        const startAngle = Math.PI / 2 + halfAngle; // 左下
        const endAngle = Math.PI / 2 - halfAngle;   // 右下
        ctx.fillStyle = "rgba(51,136,204,0.75)";
        ctx.beginPath();
        ctx.moveTo(cx - chordHalf, waterY);
        ctx.lineTo(cx + chordHalf, waterY);
        // 统一顺时针经底部(屏幕角度增大方向):dist≥0 时是底部小弧,dist<0 时是 240° 大弧
        ctx.arc(cx, cy, r - 4, endAngle, startAngle, false);
        ctx.closePath();
        ctx.fill();
        // 水面高光
        ctx.strokeStyle = "rgba(180,220,255,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - chordHalf, waterY); ctx.lineTo(cx + chordHalf, waterY); ctx.stroke();
      } else {
        // 极浅水:画一小段水面
        ctx.fillStyle = "rgba(51,136,204,0.75)";
        ctx.fillRect(cx - 1.5, cy + (r - 4) - 1, 3, 2);
      }
      // 满管警告
      if (fillRatio > 0.9) {
        ctx.strokeStyle = "rgba(255,120,60,0.85)";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // 标注
    ctx.fillStyle = "#9fb2c0";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`d=${diam.toFixed(2)}m 充满度=${(fillRatio * 100).toFixed(0)}%`, cx, h - 6);
    ctx.fillStyle = "rgba(80,170,230,0.9)";
    ctx.fillText(`水深 ${depth.toFixed(2)}m · ${flow >= 0 ? "→" : "←"} ${Math.abs(flow).toFixed(2)}m³/s`, cx, 10);
  }, [diam, depth, depthFraction, flow]);

  return (
    <div className="rounded-lg border border-gray-700 bg-black/80 p-1.5">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[10px] font-bold text-gray-300">🔵 管道横截面</span>
        <span className="text-[9px] text-gray-500">{landcover === "green" ? "🟢 绿色海绵" : landcover === "gray" ? "🟠 灰色强开发" : "⚪ 现状"}</span>
      </div>
      <canvas ref={canvasRef} className="block" />
      <div className="px-1 pt-1 text-[9px] leading-4 text-gray-500">{flowDir}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TIME-SERIES CHART PANEL
// ═══════════════════════════════════════════════════════════
function ChartPanel({ selected, dynRes, dynStep, timeStepCount, currentTimeLabel, compareRes }: {
  selected: any; dynRes: any; dynStep: number; timeStepCount: number; currentTimeLabel: string; compareRes?: Record<string, any> | null;
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
    const markData = dynStep < data.length ? [{ xAxis: timestamps[dynStep] ?? dynStep }] : [];
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
                <ReactEChartsCore echarts={echarts} option={compareOption} style={{ height: 170 }} notMerge />
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
            <ReactEChartsCore echarts={echarts} option={makeOption("水深 (m)", d, "m", "#4fc3f7")} style={{ height: chartH }} notMerge />
            <ReactEChartsCore echarts={echarts} option={makeOption("总入流 (m³/s)", ti, "m³/s", "#81c784")} style={{ height: chartH }} notMerge />
            <ReactEChartsCore echarts={echarts} option={makeOption("地表积水体积 (m³)", pv, "m³", "#ff8a65")} style={{ height: chartH }} notMerge />
            <ReactEChartsCore echarts={echarts} option={makeOption("洪泛损失", fl, "", "#ef5350")} style={{ height: chartH }} notMerge />
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
                <ReactEChartsCore echarts={echarts} option={compareOption} style={{ height: 170 }} notMerge />
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
            <ReactEChartsCore echarts={echarts} option={makeOption("流量 (m³/s)", fl, "m³/s", "#4fc3f7")} style={{ height: chartH }} notMerge />
            <ReactEChartsCore echarts={echarts} option={makeOption("水深 (m)", dp, "m", "#81c784")} style={{ height: chartH }} notMerge />
            <ReactEChartsCore echarts={echarts} option={makeOption("流速 (m/s)", vl, "m/s", "#ff8a65")} style={{ height: chartH }} notMerge />
            <ReactEChartsCore echarts={echarts} option={makeOption("容量利用率", cp, "", "#ba68c8")} style={{ height: chartH }} notMerge />
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
            <ReactEChartsCore echarts={echarts} option={compareOption} style={{ height: 170 }} notMerge />
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
  const [landcover, setLandcover] = useState<"default" | "gray" | "green">("default");
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
      renderer.domElement.addEventListener("click", e => {
        const rect = renderer.domElement.getBoundingClientRect();
        raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
        const hits = raycaster.intersectObjects(scene.children, true);
        if (hits.length > 0) {
          let obj: any = hits[0].object;
          while (obj) { if (obj.userData?.type) { if (selRef.current !== obj) { if (selRef.current) resetHL(selRef.current); selRef.current = obj; hlObj(obj); setSelected({ type: obj.userData.type, data: obj.userData.data }); } return; } obj = obj.parent; }
        }
        if (selRef.current) { resetHL(selRef.current); selRef.current = null; setSelected(null); }
      });

      let rafId = 0;
      const animate = () => {
        rafId = requestAnimationFrame(animate);
        // 环绕模式:相机绕场景中心缓慢自动旋转
        if (orbitRef.current) { camState.current.theta += 0.0022; updateCam(); }
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
  const loadSim = useCallback(async (overrideIntensity?: number) => {
    const reqSeq = ++simSeqRef.current;
    setDynPhase("loading"); setDynStep(0);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const simIntensity = overrideIntensity ?? dynI;
    try {
      const tid = setTimeout(() => ctrl.abort(), 90000);
      const res = await fetch("/api/swmm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ intensity: simIntensity, landcover }), signal: ctrl.signal });
      clearTimeout(tid);
      if (abortRef.current === ctrl) abortRef.current = null;
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || "API error");
      // 竞态防护:若期间已切换方案发起新请求,丢弃本次过期结果
      if (reqSeq !== simSeqRef.current) return;
      setDynRes(d); setDynPhase("ready"); setSimId(d.simulationId || "");
    } catch (e: any) { if (reqSeq !== simSeqRef.current) return; if (abortRef.current === ctrl) abortRef.current = null; setDynPhase("config"); if (e.name !== "AbortError") alert("仿真加载失败: " + e.message); }
  }, [dynI, landcover]);

  // 三方案对比:串行仿真 现状/绿色/灰色(后端为同步仿真,逐个请求),展示峰值差异
  const runCompare = useCallback(async () => {
    if (comparing) return;
    const seq = ++simSeqRef.current;
    abortRef.current?.abort();
    setComparing(true); setCompareRes(null); setDynPhase("loading"); setDynStep(0);
    const results: Record<string, any> = {};
    const schemes: Array<["default" | "green" | "gray", string]> = [["default", "现状"], ["green", "绿色海绵"], ["gray", "灰色强开发"]];
    try {
      for (const [lc, label] of schemes) {
        if (seq !== simSeqRef.current) return;
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const tid = setTimeout(() => ctrl.abort(), 90000);
        const res = await fetch("/api/swmm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ intensity: dynI, landcover: lc }), signal: ctrl.signal });
        clearTimeout(tid);
        if (abortRef.current === ctrl) abortRef.current = null;
        const d = await res.json();
        if (!d.ok) throw new Error(`${label}方案: ${d.error || "API error"}`);
        results[lc] = d;
      }
      if (seq !== simSeqRef.current) return;
      setCompareRes(results);
      setDynRes(results.default); setSimId(results.default.simulationId || ""); setDynPhase("ready");
    } catch (e: any) { if (seq !== simSeqRef.current) return; setDynPhase("config"); if (e.name !== "AbortError") alert("对比仿真失败: " + e.message); }
    finally { setComparing(false); }
  }, [dynI, comparing]);

  const clearWaterMeshes = useCallback(() => {
    waterMeshMap.current.forEach(m => { if (m.parent) m.parent.remove(m); m.geometry?.dispose(); (m.material as THREE.Material)?.dispose(); });
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
      childrenToRemove.forEach(c => { group.remove(c); const m = c as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | undefined; if (mat) mat.dispose(); });
      if (depth < 0.003) { if (wm) wm.visible = false; return; }
      if (!wm) {
        const wGeom = new THREE.CylinderGeometry(0.18, 0.18, 1, 8);
        const wMat = new THREE.MeshStandardMaterial({ color: "#3388cc", roughness: 0.1, metalness: 0.05, emissive: "#001122", emissiveIntensity: 0.2, transparent: true, opacity: 0.7, depthWrite: true });
        (wMat as any)._isWater = true;
        wm = new THREE.Mesh(wGeom, wMat); wm.position.set(0, invertY, 0); (wm as any).userData = { water: true };
        group.add(wm); waterMeshMap.current.set(nid, wm);
      }
      wm.visible = true;
      const wh = Math.max(0.03, depth * ve);
      wm.scale.y = wh; wm.position.y = invertY + wh / 2;
      const m = wm.material as THREE.MeshStandardMaterial;
      if (ponding > 0.01 || isOverflow) { m.color.set("#e04040"); m.emissive.set("#300000"); m.emissiveIntensity = 0.4; }
      else { const ratio = Math.min(1, depth / (ts.summary?.maxDepth?.value || 1)); m.color.set(new THREE.Color().setHSL(0.57 - ratio * 0.12, 0.7, 0.35 + ratio * 0.2)); m.emissive.set("#001122"); m.emissiveIntensity = 0.15 + ratio * 0.2; }

      // 淹没热力图:按深度比例着色的半透明圆盘(蓝绿→黄→红紫)(清理已统一在 early-return 前)
      if (heatmap && depth > 0.02) {
        const maxD = ts.summary?.maxDepth?.value || 1;
        const ratio = Math.min(1, depth / Math.max(0.05, maxD));
        const ringGeom = new THREE.CircleGeometry(0.42, 16);
        const hue = 0.62 - ratio * 0.62; // 蓝(0.62)→红(0)
        const ring = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue, 0.85, 0.55), transparent: true, opacity: 0.28 + ratio * 0.3, depthWrite: false }));
        ring.position.y = groundY + 0.01; ring.rotation.x = -Math.PI / 2; (ring as any).userData = { overflowRing: true };
        group.add(ring);
      }
      if (ponding > 0.01) {
        const ringGeom = new THREE.TorusGeometry(0.28, 0.05, 8, 10);
        const ring = new THREE.Mesh(ringGeom, new THREE.MeshStandardMaterial({ color: "#e04040", emissive: "#300000", emissiveIntensity: 0.6, roughness: 0.1 }));
        ring.position.y = groundY; ring.rotation.x = Math.PI / 2; (ring as any).userData = { overflowRing: true };
        group.add(ring);
      }
    });

    pipeMeshMap.current.forEach((mesh, pid) => {
      const ld = linkData[pid]; const flows = ld?.flow; const flow = (flows && dynStep < flows.length) ? flows[dynStep] : 0;
      const cap = ld?.capacity; const capacity = (cap && dynStep < cap.length) ? cap[dynStep] : 0;
      const absFlow = Math.abs(flow); const mat = mesh.material as THREE.MeshStandardMaterial;
      if (absFlow < 0.0005) { mat.color.set(PIPE_COLOR); mat.emissive.set(PIPE_EMISSIVE); mat.emissiveIntensity = 0.08; return; }
      const maxF = ts.summary?.maxFlow?.value || 0.1; const ratio = Math.min(1, absFlow / maxF);
      const isFull = capacity > 0.98;
      mat.color.set(new THREE.Color().setHSL(isFull ? 0.05 : 0.55 - ratio * 0.35, 0.7, 0.4 + ratio * 0.25));
      mat.emissive.set(new THREE.Color().setHSL(isFull ? 0.05 : 0.55 - ratio * 0.35, 0.7, 0.08 + ratio * 0.12));
      mat.emissiveIntensity = isFull ? 0.5 : 0.08 + ratio * 0.4;
    });
  }, [dynStep, dynRes, vertEx, heatmap]);

  useEffect(() => { if (mode !== "dynamic") clearWaterMeshes(); }, [mode, clearWaterMeshes]);

  // 当前时间步风险统计:满管管道 / 溢流节点
  const riskStats = useMemo(() => {
    if (!dynRes?.links || !dynRes?.nodes || !dataRef.current) return null;
    return computeRiskStats(dynRes.links as Record<string, { capacity?: number[] }>, dynRes.nodes as Record<string, { depth?: number[] }>, dataRef.current?.nodes, dynStep);
  }, [dynRes, dynStep]);

  // 键盘快捷键:空格 = 播放/暂停,←/→ = 步进(仅动态模式且有结果,且焦点不在输入控件)
  // 用 ref 保存最新状态,监听器只绑定一次,避免推演播放时每步重建
  const kbState = useRef({ mode, dynRes, timeStepCount, dynPhase, dynPlay, dynStep });
  kbState.current = { mode, dynRes, timeStepCount, dynPhase, dynPlay, dynStep };
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
              <div><div className="flex justify-between text-[10px]"><span className="text-gray-500">降雨倍率</span><span className="text-cyan-400 font-bold">{dynI}%</span></div>
              <input type="range" min="10" max="300" value={dynI} onChange={e => { simSeqRef.current++; setDynI(+e.target.value); setDynPhase("config"); clearWaterMeshes(); if (dynRes) setDynRes(null); }} className="w-full accent-cyan-500 mt-0.5 h-1.5" /></div>
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
              <div>
                <div className="mb-1 text-[10px] text-gray-500">下垫面方案</div>
                <div className="grid grid-cols-3 gap-1">
                  {([["default", "⚪ 现状"], ["green", "🟢 绿色海绵"], ["gray", "🟠 灰色强开发"]] as const).map(([val, label]) => (
                    <button key={val} onClick={() => { setLandcover(val); simSeqRef.current++; clearWaterMeshes(); setDynPhase("config"); if (dynRes) setDynRes(null); }} className={`py-1 rounded text-[10px] font-bold transition-colors ${landcover === val ? (val === "green" ? "bg-green-700 text-white" : val === "gray" ? "bg-orange-700 text-white" : "bg-gray-600 text-white") : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>{label}</button>
                  ))}
                </div>
                {landcover !== "default" && <div className="mt-1 text-[9px] leading-3.5 text-gray-500">{landcover === "green" ? "增加透水铺装与绿地,降低不透水率" : "增加硬化地面,提高不透水率"}</div>}
              </div>
              <button onClick={() => loadSim()} className="w-full py-1.5 bg-cyan-800 rounded font-bold text-xs hover:bg-cyan-700 transition-colors">{dynRes ? "🔄 重新仿真" : "📊 加载仿真结果"}</button>
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
                        <div key={lc} className="rounded bg-gray-800/80 p-1.5 text-center">
                          <div className={`text-[9px] ${color}`}>{label}</div>
                          <div className="text-[10px] font-bold text-gray-100">{v != null ? v.toFixed(2) : "—"}</div>
                          {lc !== "default" && <div className={`text-[9px] font-bold ${diff <= 0 ? "text-green-400" : "text-orange-400"}`}>{diff <= 0 ? "▼" : "▲"}{Math.abs(diff).toFixed(0)}%</div>}
                          {lc === "default" && <div className="text-[9px] text-gray-500">基准</div>}
                        </div>
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
                />
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
        />
      )}

      {/* ── Timeline (dynamic only) ── */}
      {mode === "dynamic" && dynRes?.ok && (dynPhase === "running" || dynPhase === "paused" || dynPhase === "done") && timeStepCount > 0 && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/92 backdrop-blur border-t border-gray-800 px-4 py-2 z-10">
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
