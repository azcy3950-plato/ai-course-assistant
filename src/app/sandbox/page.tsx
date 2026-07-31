"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { SceneManager, type Node3D, type Pipe3D, type SC3D } from "./scene/SceneManager";
import { FlowParticleSystem } from "./scene/FlowParticles";

// ═══════════════════════════════════════════════════
// INP PARSER
// ═══════════════════════════════════════════════════
const CX = 529350, CY = 305850;
function sec(t: string, s: string, e: string) { const si = t.indexOf(s); if (si < 0) return ""; const ei = t.indexOf(e, si + s.length); return t.substring(si + s.length, ei > 0 ? ei : t.length); }
function toX(x: number) { return (x - CX); }
function toZ(y: number) { return -(y - CY); }

function parseInp(text: string) {
  const coordSec = sec(text, "[COORDINATES]", "[VERTICES]");
  const juncSec  = sec(text, "[JUNCTIONS]",  "[OUTFALLS]");
  const outfSec  = sec(text, "[OUTFALLS]",   "[CONDUITS]");
  const condSec  = sec(text, "[CONDUITS]",   "[XSECTIONS]");
  const xsecSec  = sec(text, "[XSECTIONS]",  "[TIMESERIES]");
  const subcSec  = sec(text, "[SUBCATCHMENTS]", "[SUBAREAS]");
  const vertSec  = sec(text, "[VERTICES]",   "[Polygons]");
  const polyIdx  = text.indexOf("[Polygons]");
  const polySec  = polyIdx >= 0 ? text.substring(polyIdx + "[Polygons]".length) : "";

  type RawNode = { x: number; z: number; invert: number; maxD: number; initD: number; type: string };
  const rawNodes = new Map<string, RawNode>();
  coordSec.split("\n").forEach(line => { const m = line.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)/); if (m) rawNodes.set(m[1], { x: toX(parseFloat(m[2])), z: toZ(parseFloat(m[3])), invert: 0, maxD: 3.5, initD: 0, type: "junction" }); });
  juncSec.split("\n").forEach(line => { const m = line.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/); if (m && rawNodes.has(m[1])) { const n = rawNodes.get(m[1])!; n.invert = parseFloat(m[2]); n.maxD = parseFloat(m[3]); n.initD = parseFloat(m[4]) || 0; } });
  const outfallIds = new Set<string>();
  outfSec.split("\n").forEach(line => { const m = line.trim().match(/^(\S+)\s+([\d.]+)/); if (m) { outfallIds.add(m[1]); if (rawNodes.has(m[1])) { rawNodes.get(m[1])!.invert = parseFloat(m[2]); rawNodes.get(m[1])!.type = "outfall"; } } });
  const diamMap = new Map<string, number>(), shapeMap = new Map<string, string>();
  xsecSec.split("\n").forEach(line => { const m = line.trim().match(/^(\S+)\s+(\S+)\s+([\d.]+)/); if (m) { diamMap.set(m[1], parseFloat(m[3])); shapeMap.set(m[1], m[2]); } });
  const pipes: Pipe3D[] = [];
  condSec.split("\n").forEach(line => { const m = line.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/); if (m) { const fn = rawNodes.get(m[2]), tn = rawNodes.get(m[3]); pipes.push({ id: m[1], from: m[2], to: m[3], diam: diamMap.get(m[1]) || 0.3, length: parseFloat(m[4]), roughness: parseFloat(m[5]) || 0.013, fromInv: fn?.invert || 0, toInv: tn?.invert || 0, shape: shapeMap.get(m[1]) || "CIRCULAR", inOffset: parseFloat(m[6]) || 0, outOffset: parseFloat(m[7]) || 0, verts: [] }); } });
  const vertMap = new Map<string, [number,number][]>();
  vertSec.split("\n").forEach(line => { const m = line.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)/); if (m) { if (!vertMap.has(m[1])) vertMap.set(m[1], []); vertMap.get(m[1])!.push([toX(parseFloat(m[2])), toZ(parseFloat(m[3]))]); } });
  pipes.forEach(p => { p.verts = vertMap.get(p.id) || []; });
  const impervMap = new Map<string, number>(), scArea = new Map<string, number>(), scOutlet = new Map<string, string>(), scWidth = new Map<string, number>(), scSlope = new Map<string, number>();
  subcSec.split("\n").forEach(line => { const m = line.trim().match(/^(\S+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/); if (m) { scOutlet.set(m[1], m[2]); scArea.set(m[1], parseFloat(m[3])); impervMap.set(m[1], parseFloat(m[4])); scWidth.set(m[1], parseFloat(m[5]) || 0); scSlope.set(m[1], parseFloat(m[6]) || 0); } });
  const scs: SC3D[] = [];
  let curId = "", curPts: [number,number][] = [];
  polySec.split("\n").forEach(line => { const m = line.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)/); if (m) { if (m[1] !== curId) { if (curPts.length >= 3) scs.push({ id: curId, pts: curPts, imperv: impervMap.get(curId) || 50, area: scArea.get(curId) || 0, outlet: scOutlet.get(curId) || "", width: scWidth.get(curId) || 0, slope: scSlope.get(curId) || 0 }); curId = m[1]; curPts = []; } curPts.push([toX(parseFloat(m[2])), toZ(parseFloat(m[3]))]); } });
  if (curPts.length >= 3) scs.push({ id: curId, pts: curPts, imperv: impervMap.get(curId) || 50, area: scArea.get(curId) || 0, outlet: scOutlet.get(curId) || "", width: scWidth.get(curId) || 0, slope: scSlope.get(curId) || 0 });
  const nodeList: Node3D[] = [];
  rawNodes.forEach((n, id) => { nodeList.push({ id, x: n.x, z: n.z, invert: n.invert, maxD: n.maxD, initD: n.initD, ground: n.invert + n.maxD, type: n.type }); });
  return { nodes: nodeList, pipes, scs, outfallIds };
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
function chLabel(k: string): string {
  const m: Record<string,string> = { id:"编号",type:"类型",invert:"井底高程",ground:"地表高程",maxDepth:"最大水深",initDepth:"初始水深",from:"起点",to:"终点",diam:"管径",length:"长度",roughness:"糙率",shape:"断面形式",inOffset:"起点偏移",outOffset:"终点偏移",area:"面积",imperv:"不透水率",outlet:"出口节点",width:"宽度",slope:"坡度",vertices:"边界顶点数",vertCount:"中间顶点数",depth:"当前水深",totalInflow:"总入流",pondedVolume:"地表积水体积",floodingLosses:"节点洪泛损失",flow:"当前流量",velocity:"当前流速",capacity:"容量利用率",depthFraction:"充满度",volume:"当前体积" };
  return m[k] || k;
}
function fmtVal(k: string, v: any): string {
  if (v == null || v === "") return "未配置";
  if (typeof v !== "number") return String(v);
  if (k === "area") return (v / 10000).toFixed(3) + " ha";
  if (k === "imperv") return v.toFixed(0) + " %";
  if (k === "slope") return (v * 100).toFixed(2) + " %";
  if (["invert","ground","maxDepth","initDepth","diam","length","inOffset","outOffset","width"].includes(k)) return v.toFixed(2) + " m";
  return v.toFixed(3);
}
function fmtTime(h: number) { const m = Math.round(h*60); return `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`; }

// ═══════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════
export default function SandboxPage() {
  const cr = useRef<HTMLDivElement>(null);
  const smRef = useRef<SceneManager | null>(null);
  const fpRef = useRef<FlowParticleSystem | null>(null);
  const dataRef = useRef<any>(null);
  const selRef = useRef<THREE.Object3D | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"static"|"dynamic">("static");
  const [selected, setSelected] = useState<any>(null);
  const [hovered, setHovered] = useState<any>(null);
  const [layers, setLayers] = useState<Record<string,boolean>>({ terrain:true, sc:true, pipes:true, nodes:true });
  const [stats, setStats] = useState({ nodes:0, pipes:0, scs:0 });
  const [ve, setVe] = useState(8);
  const [clipOn, setClipOn] = useState(true);
  const [clipOffset, setClipOffset] = useState(0);
  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState<any[]>([]);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [isolated, setIsolated] = useState<string|null>(null);

  // Dynamic
  const [dynI, setDynI] = useState(100);
  const [dynRes, setDynRes] = useState<any>(null);
  const [dynStep, setDynStep] = useState(0);
  const [dynPlay, setDynPlay] = useState(false);
  const [dynSpd, setDynSpd] = useState(1);
  const [dynPhase, setDynPhase] = useState<"config"|"loading"|"ready"|"running"|"paused"|"done">("config");
  const [simId, setSimId] = useState("");
  const [showCurves, setShowCurves] = useState(false);

  const tsc = dynRes?.timeStepCount || 0;
  const timestamps: number[] = dynRes?.timestamps || [];
  const curTime = timestamps[dynStep] !== undefined ? fmtTime(timestamps[dynStep]) : "--:--";

  // ═══════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════
  useEffect(() => { (async () => {
    try {
      const r = await fetch("/zijing_inp.inp");
      if (!r.ok) throw new Error("INP 加载失败");
      const data = parseInp(await r.text());
      dataRef.current = data;
      setStats({ nodes: data.nodes.length, pipes: data.pipes.length, scs: data.scs.length });
      if (!cr.current) return;

      const sm = new SceneManager(cr.current);
      smRef.current = sm;
      sm.build(data, 8);
      sm.defaultCamera();

      const fp = new FlowParticleSystem(sm.scene);
      fpRef.current = fp;
      // Register all pipes for flow particles
      sm.pipeMap.forEach((v, id) => { fp.registerPipe(id, v.mesh, v.curve); });

      // Selection via raycaster
      const raycaster = new THREE.Raycaster();
      const onPointerDown = (e: PointerEvent) => {
        if (e.button > 1) return;
        const rect = sm.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(mouse, sm.camera);
        const hits = raycaster.intersectObjects(sm.scene.children, true);
        if (hits.length > 0) {
          let obj: any = hits[0].object;
          while (obj) {
            if (obj.userData?.type) {
              if (selRef.current !== obj) { clearSel(); selRef.current = obj; highlightObj(obj); setSelected({ type: obj.userData.type, data: obj.userData.data }); }
              return;
            }
            obj = obj.parent;
          }
        }
        clearSel(); setSelected(null);
      };
      const onPointerMove = (e: PointerEvent) => {
        const rect = sm.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(mouse, sm.camera);
        const hits = raycaster.intersectObjects(sm.scene.children, true);
        let found: any = null;
        if (hits.length > 0) { let obj: any = hits[0].object; while (obj) { if (obj.userData?.type) { found = obj; break; } obj = obj.parent; } }
        setHovered(found ? { type: found.userData.type, data: found.userData.data } : null);
        cr.current!.style.cursor = found ? "pointer" : "";
      };
      sm.renderer.domElement.addEventListener("pointerdown", onPointerDown);
      sm.renderer.domElement.addEventListener("pointermove", onPointerMove);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") { clearSel(); setSelected(null); } });

      sm.animate(() => {
        if (fpRef.current && mode === "dynamic" && dynPhase === "running") {
          fpRef.current.update(dynStep);
        }
      });

      setLoaded(true);
      return () => { sm.renderer.domElement.removeEventListener("pointerdown", onPointerDown); sm.renderer.domElement.removeEventListener("pointermove", onPointerMove); sm.dispose(); };
    } catch (e: any) { setError(e.message); }
  })(); }, []);

  function highlightObj(o: THREE.Object3D) {
    o.traverse(c => { if (c instanceof THREE.Mesh && c.material && !(c.material as any)._isW) { const m = c.material as any; m.emissive = new THREE.Color("#ffff44"); m.emissiveIntensity = 0.5; } });
  }
  function clearSel() {
    if (selRef.current) { selRef.current.traverse(c => { if (c instanceof THREE.Mesh && c.material && !(c.material as any)._isW) { const m = c.material as any; m.emissive = new THREE.Color("#000"); m.emissiveIntensity = 0; } }); selRef.current = null; }
  }

  // ═══════════════════════════════════════════════════
  // VIEW / SEARCH / ISOLATE
  // ═══════════════════════════════════════════════════
  const focusObj = (obj: any) => {
    const sm = smRef.current; if (!sm || !obj) return;
    let tx = 0, tz = 0;
    if (obj.type === "node") { const n = sm.data.nodes.find((nn: Node3D) => nn.id === obj.data.id); if (n) { tx = n.x; tz = n.z; } }
    else if (obj.type === "pipe") { const fn = sm.data.nodes.find((nn: Node3D) => nn.id === obj.data.from); const tn = sm.data.nodes.find((nn: Node3D) => nn.id === obj.data.to); if (fn && tn) { tx = (fn.x + tn.x) / 2; tz = (fn.z + tn.z) / 2; } }
    const cy = sm.ey(sm.minElev + (sm.avgSurface - sm.minElev) * 0.3);
    sm.camera.position.set(tx + sm.span * 0.3 * Math.cos(0.45), cy + sm.span * 0.25, tz + sm.span * 0.3 * Math.sin(0.45));
    sm.camera.lookAt(tx, cy, tz);
  };

  const doSearch = (q: string) => { setSearchQ(q); if (!q.trim() || !dataRef.current) { setSearchRes([]); return; } const d = dataRef.current; const ql = q.toLowerCase(); const r: any[] = []; d.nodes.forEach((n: Node3D) => { if (n.id.toLowerCase().includes(ql)) r.push({ type: "node", data: { id: n.id, type: n.type, invert: n.invert, ground: n.ground } }); }); d.pipes.forEach((p: Pipe3D) => { if (p.id.toLowerCase().includes(ql) || p.from.toLowerCase().includes(ql) || p.to.toLowerCase().includes(ql)) r.push({ type: "pipe", data: { id: p.id, from: p.from, to: p.to, diam: p.diam } }); }); setSearchRes(r.slice(0, 20)); };
  const locateRes = (r: any) => { setSelected(r); focusObj(r); };

  const isolateObj = (obj: any) => {
    if (!obj || !smRef.current) return;
    setIsolated(obj.data.id);
    smRef.current.groups.nodes.children.forEach((g: any) => { g.visible = g.userData?.data?.id === obj.data.id; });
    smRef.current.groups.pipes.children.forEach((m: any) => { const d2 = m.userData?.data; m.visible = d2?.id === obj.data.id || d2?.from === obj.data.id || d2?.to === obj.data.id; });
  };
  const resetIsolation = () => { setIsolated(null); if (smRef.current) { smRef.current.groups.nodes.children.forEach((g: any) => { g.visible = true; }); smRef.current.groups.pipes.children.forEach((m: any) => { m.visible = true; }); } };

  const toggleLayer = (id: string) => { setLayers(p => { const n = !p[id]; const g = smRef.current?.groups[id]; if (g) g.visible = n; return { ...p, [id]: n }; }); };

  // ═══════════════════════════════════════════════════
  // DYNAMIC
  // ═══════════════════════════════════════════════════
  const loadSim = useCallback(async () => {
    setDynPhase("loading"); setDynStep(0);
    try {
      const ctrl = new AbortController(); const tid = setTimeout(() => ctrl.abort(), 90000);
      const res = await fetch("/api/swmm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intensity: dynI }), signal: ctrl.signal });
      clearTimeout(tid); const d = await res.json();
      if (!d.ok) throw new Error(d.error || "API error");
      setDynRes(d); setDynPhase("ready"); setSimId(d.simulationId || "");
      // Feed data to flow particles
      if (fpRef.current && d.links) {
        Object.entries(d.links).forEach(([lid, ld]: [string, any]) => {
          fpRef.current!.setData(lid, ld.flow || [], ld.velocity || [], ld.capacity || []);
        });
      }
    } catch (e: any) { setDynPhase("config"); if (e.name !== "AbortError") alert("仿真失败: " + e.message); }
  }, [dynI]);

  useEffect(() => { if (!dynPlay || dynPhase !== "running" || tsc === 0) return; const t = setInterval(() => { setDynStep(p => { const n = p + 1; if (n >= tsc - 1) { setDynPlay(false); setDynPhase("done"); return tsc - 1; } return n; }); }, 140 / dynSpd); return () => clearInterval(t); }, [dynPlay, dynSpd, dynPhase, tsc]);

  // Update water columns
  useEffect(() => {
    if (!dynRes?.nodes || !smRef.current) return;
    const sm = smRef.current;
    sm.nodeMap.forEach(({ g, iy, gy }, nid) => {
      const nd = dynRes.nodes[nid]; const depth = nd?.depth?.[dynStep] ?? 0;
      const ponding = nd?.pondedVolume?.[dynStep] ?? 0;
      const nodeInfo = sm.data.nodes.find((n: Node3D) => n.id === nid);
      const isOverflow = nodeInfo && depth > (nodeInfo.maxD || 99);

      let wm = sm.waterMap.get(nid);
      if (depth < 0.003) { if (wm) wm.visible = false; return; }
      if (!wm) {
        const wg = new THREE.CylinderGeometry(0.18, 0.18, 1, 8);
        const wmt = new THREE.MeshStandardMaterial({ color: "#3388cc", roughness: 0.1, metalness: 0.05, emissive: "#001122", emissiveIntensity: 0.2, transparent: true, opacity: 0.7, depthWrite: true });
        (wmt as any)._isW = true; wm = new THREE.Mesh(wg, wmt); wm.position.set(0, iy, 0);
        (wm as any).userData = { water: true }; g.add(wm); sm.waterMap.set(nid, wm);
      }
      wm.visible = true;
      const wh = Math.max(0.03, depth * sm.ve);
      wm.scale.y = wh; wm.position.y = iy + wh / 2;
      const m = wm.material as THREE.MeshStandardMaterial;
      if (ponding > 0.01 || isOverflow) { m.color.set("#e04040"); m.emissive.set("#300000"); m.emissiveIntensity = 0.4; }
      else { const r2 = Math.min(1, depth / (dynRes.summary?.maxDepth?.value || 1)); m.color.set(new THREE.Color().setHSL(0.57 - r2 * 0.12, 0.7, 0.35 + r2 * 0.2)); m.emissive.set("#001122"); m.emissiveIntensity = 0.15 + r2 * 0.2; }
    });
  }, [dynStep, dynRes, ve]);

  // Cleanup water on mode change
  useEffect(() => { if (mode !== "dynamic") { const sm = smRef.current; if (sm) { sm.waterMap.forEach(wm => { if (wm.parent) wm.parent.remove(wm); wm.geometry?.dispose(); (wm.material as THREE.Material)?.dispose(); }); sm.waterMap.clear(); } fpRef.current?.clear(); } }, [mode]);

  // ═══════════════════════════════════════════════════
  // DYNAMIC PROPERTY HELPERS
  // ═══════════════════════════════════════════════════
  const curNodeData = (mode === "dynamic" && selected?.type === "node" && dynRes?.nodes) ? dynRes.nodes[selected.data.id] : null;
  const curLinkData = (mode === "dynamic" && selected?.type === "pipe" && dynRes?.links) ? dynRes.links[selected.data.id] : null;

  // ═══════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════
  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-black relative overflow-hidden">
      {/*═══ TOP BAR ═══*/}
      <div className="absolute top-0 left-0 right-0 z-20 bg-black/94 backdrop-blur border-b border-gray-800 flex items-center px-3 gap-2" style={{ height: 50 }}>
        <span className="font-bold text-gray-200 text-sm mr-1">🌊 紫荆雅园</span>
        <div className="flex bg-gray-800 rounded-lg p-0.5">
          <button onClick={() => setMode("static")} className={"px-4 py-1.5 rounded-md font-bold text-sm " + (mode === "static" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white")}>📐 静态沙盘</button>
          <button onClick={() => setMode("dynamic")} className={"px-4 py-1.5 rounded-md font-bold text-sm " + (mode === "dynamic" ? "bg-cyan-600 text-white" : "text-gray-400 hover:text-white")}>▶ 动态推演</button>
        </div>
        <div className="h-5 w-px bg-gray-600" />
        <button onClick={() => { const sm = smRef.current; if (sm) sm.defaultCamera(); }} className="px-2 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 rounded text-gray-300" title="全景">🏠</button>
        <button onClick={() => { const sm = smRef.current; if (sm) { const d = sm.data; if (d) { let cx2 = 0, cz2 = 0, cy = 0; d.nodes.forEach((n: Node3D) => { cx2 += n.x; cz2 += n.z; cy += sm.ey(n.ground); }); cx2 /= d.nodes.length; cz2 /= d.nodes.length; cy /= d.nodes.length; sm.camera.position.set(cx2, cy + sm.span * 0.8, cz2 + 5); sm.camera.lookAt(cx2, cy, cz2); } } }} className="px-2 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 rounded text-gray-300" title="俯视">🔽</button>
        <button onClick={() => { const sm = smRef.current; if (sm) { const d = sm.data; if (d) { let cx2 = 0, cz2 = 0, minY = Infinity; d.nodes.forEach((n: Node3D) => { cx2 += n.x; cz2 += n.z; const iy = sm.ey(n.invert); if (iy < minY) minY = iy; }); cx2 /= d.nodes.length; cz2 /= d.nodes.length; sm.groups.terrain.visible = false; sm.groups.sc.visible = false; sm.camera.position.set(cx2 + sm.span * 0.3, minY + sm.span * 0.2, cz2 + sm.span * 0.3); sm.camera.lookAt(cx2, minY, cz2); } } }} className="px-2 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 rounded text-gray-300" title="地下">⛏</button>
        <button onClick={() => { if (smRef.current) { const v = smRef.current.toggleClipping(); setClipOn(v); } }} className={"px-2 py-1 text-[11px] rounded text-gray-300 " + (clipOn ? "bg-cyan-800" : "bg-gray-800 hover:bg-gray-700")} title="剖切">✂</button>
        <button onClick={() => { if (cr.current) { if (document.fullscreenElement) document.exitFullscreen(); else cr.current.requestFullscreen(); } }} className="px-2 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 rounded text-gray-300" title="全屏">⛶</button>
        <div className="h-5 w-px bg-gray-600" />
        <span className="text-[10px] text-gray-500">垂直:</span>
        {[1, 3, 5, 8, 12].map(v => (<button key={v} onClick={() => { setVe(v); smRef.current?.build(dataRef.current, v); smRef.current?.defaultCamera(); }} className={"px-1.5 py-0.5 rounded text-[10px] " + (ve === v ? "bg-blue-700" : "bg-gray-800 text-gray-400")}>{v}×</button>))}
        <span className="text-[9px] text-gray-600 ml-auto">{stats.nodes}节点·{stats.pipes}管·{stats.scs}汇水区 | VE: {ve}× | 地表: 节点高程插值工程曲面</span>
      </div>

      {/*═══ LEFT PANEL ═══*/}
      <div className={"absolute left-0 z-20 bg-black/93 backdrop-blur border-r border-gray-800 transition-all flex flex-col " + (leftOpen ? "w-[220px]" : "w-[28px]")} style={{ top: 50, bottom: 0 }}>
        <button onClick={() => setLeftOpen(!leftOpen)} className="absolute -right-5 top-2 w-5 h-10 bg-gray-800 rounded-r text-[10px] text-gray-400">{leftOpen ? "◀" : "▶"}</button>
        {leftOpen && <div className="p-2 overflow-y-auto flex-1">
          <div className="text-[11px] font-bold text-gray-400 mb-2">图层 & 搜索</div>
          {[{ id: "terrain", l: "地表(TIN)" }, { id: "sc", l: "汇水区" }, { id: "pipes", l: "管道" }, { id: "nodes", l: "节点" }].map(({ id, l }) => (
            <label key={id} className="flex items-center gap-2 text-[11px] text-gray-400 hover:text-gray-200 cursor-pointer"><input type="checkbox" checked={layers[id]} onChange={() => toggleLayer(id)} className="accent-cyan-500" />{l}</label>
          ))}
          <div className="mt-2"><div className="text-[10px] text-gray-500 mb-1">剖切位置</div><input type="range" min={-200} max={200} value={clipOffset} onChange={e => { setClipOffset(+e.target.value); smRef.current?.setClipOffset(+e.target.value); }} className="w-full accent-cyan-500 h-1.5" /></div>
          <div className="mt-2"><input type="text" placeholder="搜索节点/管道…" value={searchQ} onChange={e => doSearch(e.target.value)} className="w-full bg-gray-800 rounded px-2 py-1 text-[11px] text-gray-200 border border-gray-700 focus:border-cyan-600 outline-none" /></div>
          {searchRes.length > 0 && <div className="space-y-0.5 max-h-[200px] overflow-y-auto mt-1">{searchRes.map((r, i) => (<div key={i} onClick={() => locateRes(r)} className="text-[10px] text-gray-400 hover:text-white hover:bg-gray-800 rounded px-1.5 py-0.5 cursor-pointer truncate">{r.type === "node" ? "🔹" : "▬"} {r.data.id}</div>))}</div>}
          {isolated && <button onClick={resetIsolation} className="w-full text-[10px] bg-red-900 hover:bg-red-800 rounded px-2 py-1 text-gray-300 mt-2">恢复完整模型</button>}
          {selected && !isolated && <button onClick={() => isolateObj(selected)} className="w-full text-[10px] bg-gray-800 hover:bg-gray-700 rounded px-2 py-1 text-gray-400 mt-1">🔍 隔离查看</button>}
          {mode === "dynamic" && dynRes && <div className="text-[10px] text-gray-500 mt-2 space-y-1"><div className="font-bold text-[11px] text-gray-400">📊 仿真概要</div><div>maxD: {dynRes.summary?.maxDepth?.value?.toFixed(2)}m @{dynRes.summary?.maxDepth?.nodeId}</div><div>maxF: {dynRes.summary?.maxFlow?.value?.toFixed(2)} @{dynRes.summary?.maxFlow?.linkId}</div></div>}
          <div className="text-[8px] text-gray-600 mt-2">当前地形为根据节点地表高程生成的工程TIN曲面，不代表真实DEM。</div>
        </div>}
      </div>

      {/*═══ SCENE ═══*/}
      <div ref={cr} className="flex-1" />

      {/*═══ RIGHT DRAWER ═══*/}
      <div className={"absolute right-0 z-20 bg-black/93 backdrop-blur border-l border-gray-800 transition-all flex flex-col overflow-y-auto " + (rightOpen ? "w-[320px]" : "w-[28px]")} style={{ top: 50, bottom: mode === "dynamic" && dynRes?.ok ? 120 : 0 }}>
        <button onClick={() => setRightOpen(!rightOpen)} className="absolute -left-5 top-2 w-5 h-10 bg-gray-800 rounded-l text-[10px] text-gray-400">{rightOpen ? "▶" : "◀"}</button>
        {rightOpen && <div className="p-2.5">
          {mode === "static" && selected && (<>
            <div className="text-xs font-bold text-gray-300 mb-2 flex justify-between"><span>{{ node: "🔹 节点", pipe: "▬ 管道", subcatchment: "▨ 汇水区" }[selected.type as string] || selected.type}</span><button onClick={() => { clearSel(); setSelected(null); }} className="text-gray-500">✕</button></div>
            <div className="space-y-0.5">{Object.entries(selected.data).map(([k, v]: [string, any]) => (<div key={k} className="flex justify-between text-[11px]"><span className="text-gray-500">{chLabel(k)}</span><span className="text-gray-200 text-right ml-2">{k === "type" ? (v === "outfall" ? "出水口" : "检查井") : fmtVal(k, v)}</span></div>))}</div>
            {selected.type === "node" && <div className="mt-2 text-[10px] text-gray-500">井深: {fmtVal("maxDepth", selected.data.maxDepth)} | 井底: {fmtVal("invert", selected.data.invert)} | 地表: {fmtVal("ground", selected.data.ground)}</div>}
          </>)}
          {mode === "static" && !selected && <div className="text-[11px] text-gray-600 text-center py-8">点击对象查看属性</div>}

          {mode === "dynamic" && (<>
            <div className="text-xs font-bold text-gray-300 mb-2">{{ config: "⚙️ 场景配置", loading: "⏳ 仿真中…", ready: "📊 就绪", running: "🔵 运行中", paused: "⏸ 暂停", done: "✅ 完成" }[dynPhase]}</div>
            {(dynPhase === "config" || dynPhase === "ready" || dynPhase === "done") && (<div className="space-y-2">
              <div><div className="flex justify-between text-[11px]"><span className="text-gray-500">降雨倍率</span><span className="text-cyan-400 font-bold">{dynI}%</span></div><input type="range" min="10" max="300" value={dynI} onChange={e => setDynI(+e.target.value)} className="w-full accent-cyan-500 mt-0.5 h-1.5" /></div>
              {dynRes && <div className="text-[10px] text-gray-500">步数: {dynRes.timeStepCount} | {dynRes.metadata?.startTime?.slice(0, 16)} → {dynRes.metadata?.endTime?.slice(11, 16)}</div>}
              <button onClick={loadSim} className="w-full py-2 bg-cyan-800 rounded font-bold text-xs hover:bg-cyan-700">{dynRes ? "🔄 重新仿真" : "📊 开始推演"}</button>
              {dynPhase === "ready" && <button onClick={() => { setDynPhase("running"); setDynPlay(true); setDynStep(0); }} className="w-full py-2 bg-green-800 rounded font-bold text-xs hover:bg-green-700">▶ 播放</button>}
              {dynPhase === "done" && <button onClick={() => { setDynStep(0); setDynPlay(true); setDynPhase("running"); }} className="w-full py-2 bg-green-800 rounded font-bold text-xs hover:bg-green-700">🔄 重新播放</button>}
            </div>)}
            {(dynPhase === "running" || dynPhase === "paused") && (<div className="space-y-2"><div className="flex justify-between text-[11px]"><span className="text-gray-500">当前时间</span><span className="text-gray-200 font-mono">{curTime}</span></div><div className="flex justify-between text-[11px]"><span className="text-gray-500">当前步</span><span className="text-gray-200">{dynStep + 1}/{tsc}</span></div></div>)}
            {dynPhase === "loading" && <div className="text-center py-4"><div className="animate-spin text-lg mb-1">⏳</div><div className="text-[10px] text-gray-400">运行SWMM仿真…</div></div>}
            {simId && <div className="text-[9px] text-gray-600 mt-1 truncate">ID: {simId.slice(0, 12)}…</div>}

            {selected && (dynPhase === "running" || dynPhase === "paused" || dynPhase === "done") && (<div className="border-t border-gray-700 mt-2 pt-2 space-y-0.5">
              <div className="text-xs font-bold text-gray-300 mb-1">{{ node: "🔹 " + selected.data.id, pipe: "▬ " + selected.data.id }[selected.type as string]}</div>
              {selected.type === "node" && curNodeData && (<>
                <DP l="当前水深" v={curNodeData.depth?.[dynStep] ?? 0} u="m" />
                <DP l="总入流" v={curNodeData.totalInflow?.[dynStep] ?? 0} u="m³/s" />
                <DP l="地表积水" v={curNodeData.pondedVolume?.[dynStep] ?? 0} u="m³" warn={(curNodeData.pondedVolume?.[dynStep] ?? 0) > 0.01} />
                <DP l="洪泛损失" v={curNodeData.floodingLosses?.[dynStep] ?? 0} u="" warn={(curNodeData.floodingLosses?.[dynStep] ?? 0) > 0.01} />
              </>)}
              {selected.type === "pipe" && curLinkData && (<>
                <DP l="当前流量" v={curLinkData.flow?.[dynStep] ?? 0} u="m³/s" />
                <DP l="当前流速" v={curLinkData.velocity?.[dynStep] ?? 0} u="m/s" />
                <DP l="水深" v={curLinkData.depth?.[dynStep] ?? 0} u="m" />
                <DP l="充满度" v={(curLinkData.depthFraction?.[dynStep] ?? 0) * 100} u="%" pct />
                <DP l="容量" v={curLinkData.capacity?.[dynStep] ?? 0} u="" />
                <DP l="流向" l2={(curLinkData.flow?.[dynStep] ?? 0) >= 0 ? selected.data.to : selected.data.from} dir />
              </>)}
              <button onClick={() => setShowCurves(!showCurves)} className="w-full text-[10px] bg-gray-800 hover:bg-gray-700 rounded px-2 py-1 text-gray-400 mt-1">📈 {showCurves ? "收起曲线" : "展开曲线"}</button>
            </div>)}
          </>)}
        </div>}
      </div>

      {/*═══ PLAYBACK BAR ═══*/}
      {mode === "dynamic" && dynRes?.ok && (dynPhase === "running" || dynPhase === "paused" || dynPhase === "done") && tsc > 0 && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/95 backdrop-blur border-t border-gray-800 z-20 px-4 py-2" style={{ height: 120 }}>
          <div className="flex items-center gap-1.5 justify-center mb-1">
            <PB icon="⏮" onClick={() => setDynStep(0)} />
            <PB icon="◀◀" onClick={() => setDynStep(s => Math.max(0, s - 10))} />
            <PB icon="◀" onClick={() => setDynStep(s => Math.max(0, s - 1))} />
            {dynPhase === "running" ? <PB icon="⏸" onClick={() => { setDynPlay(false); setDynPhase("paused"); }} cls="bg-yellow-800 hover:bg-yellow-700" /> : <PB icon="▶" onClick={() => { if (dynStep >= tsc - 1) setDynStep(0); setDynPlay(true); setDynPhase("running"); }} cls="bg-green-800 hover:bg-green-700" />}
            <PB icon="▶▶" onClick={() => setDynStep(s => Math.min(tsc - 1, s + 10))} />
            <PB icon="⏭" onClick={() => setDynStep(tsc - 1)} />
            <PB icon="⏹" onClick={() => { setDynPlay(false); setDynPhase("done"); }} cls="bg-red-900 hover:bg-red-800" />
            <span className="text-[11px] text-gray-400 font-mono w-12 text-center ml-2">{curTime}</span>
            <span className="text-[10px] text-gray-500">{dynStep + 1}/{tsc}</span>
            {[0.5, 1, 2, 5].map(s => (<button key={s} onClick={() => setDynSpd(s)} className={"px-2 py-0.5 rounded text-[10px] " + (dynSpd === s ? "bg-cyan-800 text-white" : "bg-gray-800 text-gray-400")}>{s}×</button>))}
          </div>
          <input type="range" min={0} max={tsc - 1} value={dynStep} onChange={e => { setDynStep(+e.target.value); if (dynPlay) { setDynPlay(false); setDynPhase("paused"); } }} className="w-full h-2 appearance-none bg-gray-800 rounded-full cursor-pointer [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full" />
        </div>
      )}

      {/*═══ CURVES ═══*/}
      {mode === "dynamic" && showCurves && selected && dynRes?.ok && tsc > 0 && (
        <CurvePanel selected={selected} dynRes={dynRes} dynStep={dynStep} timestamps={timestamps} curTime={curTime} tsc={tsc} onClose={() => setShowCurves(false)} />
      )}

      {/*═══ OVERLAYS ═══*/}
      {!loaded && !error && <div className="absolute inset-0 flex items-center justify-center bg-gray-950 z-30"><span className="animate-spin mr-2">⏳</span><span className="text-sm text-gray-300">加载SWMM模型…</span></div>}
      {error && <div className="absolute inset-0 flex items-center justify-center bg-gray-950 z-30"><div className="text-center bg-red-900/60 rounded-xl p-6 max-w-md"><div className="text-2xl mb-2">⚠️</div><div className="text-sm mb-1 text-gray-200">{error}</div><button onClick={() => window.location.reload()} className="mt-3 px-4 py-1.5 bg-red-800 rounded text-xs hover:bg-red-700 text-white">刷新</button></div></div>}
      {hovered && <div className="absolute z-30 pointer-events-none bg-black/88 backdrop-blur rounded px-2 py-1 text-[10px] text-gray-200 border border-gray-700" style={{ left: 230, top: 60 }}>{{ node: "🔹 节点", pipe: "▬ 管道", subcatchment: "▨ 汇水区" }[hovered.type as string] || hovered.type} {hovered.data?.id}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// MICRO COMPONENTS
// ═══════════════════════════════════════════════════
function PB({ icon, onClick, cls }: { icon: string; onClick: () => void; cls?: string }) {
  return <button onClick={onClick} className={"px-2 py-1 rounded text-xs font-bold " + (cls || "bg-gray-800 hover:bg-gray-700 text-gray-300")}>{icon}</button>;
}
function DP({ l, v, u, warn, pct, dir, l2 }: { l: string; v?: number; u?: string; warn?: boolean; pct?: boolean; dir?: boolean; l2?: string }) {
  if (dir) return <div className="flex justify-between text-[11px]"><span className="text-gray-500">{l}</span><span className="text-gray-200">→ {l2}</span></div>;
  return <div className="flex justify-between text-[11px]"><span className="text-gray-500">{l}</span><span className={warn ? "text-red-400" : "text-gray-200"}>{pct ? (v ?? 0).toFixed(0) + (u || "") : (v ?? 0).toFixed(3) + (u ? " " + u : "")}</span></div>;
}

// ═══════════════════════════════════════════════════
// ECHARTS CURVE PANEL
// ═══════════════════════════════════════════════════
let echReady = false;
async function initEcharts() {
  if (echReady) return (await import("echarts/core")).default;
  const [core, charts, comps, rend] = await Promise.all([import("echarts/core"), import("echarts/charts"), import("echarts/components"), import("echarts/renderers")]);
  core.use([charts.LineChart, comps.GridComponent, comps.TooltipComponent, comps.LegendComponent, rend.CanvasRenderer]);
  echReady = true; return core;
}

function CurvePanel({ selected, dynRes, dynStep, timestamps, curTime, tsc, onClose }: any) {
  const refs = useRef<(HTMLDivElement | null)[]>([null, null, null, null]);

  useEffect(() => {
    initEcharts().then(core => {
      const ts = timestamps.map((t: number) => t.toFixed(1) + "h");
      const mark = dynStep < ts.length ? [{ xAxis: ts[dynStep] }] : [];
      const makeOpt = (data: number[], yLab: string, title: string, color: string) => ({
        backgroundColor: "transparent", grid: { top: 24, right: 8, bottom: 18, left: 40 },
        xAxis: { type: "category", data: ts, axisLabel: { color: "#888", fontSize: 8, interval: Math.max(0, Math.floor(ts.length / 6) - 1) } },
        yAxis: { type: "value", name: yLab, nameTextStyle: { color: "#888", fontSize: 8 }, axisLabel: { color: "#888", fontSize: 8 } },
        series: [{ name: title, type: "line", data, smooth: false, symbol: "none", lineStyle: { color, width: 1.2 },
          markLine: dynStep < data.length ? { silent: true, symbol: "none", lineStyle: { color: "#ff0", width: 1, type: "dashed" }, data: mark, label: { show: true, formatter: curTime, color: "#ff0", fontSize: 8 } } : undefined,
        }],
      });

      let configs: { data: number[]; yLab: string; title: string; color: string }[] = [];
      if (selected.type === "node") {
        const nd = dynRes?.nodes?.[selected.data.id];
        if (nd) configs = [
          { data: nd.depth || [], yLab: "m", title: "水深", color: "#4fc3f7" },
          { data: nd.totalInflow || [], yLab: "m³/s", title: "总入流", color: "#81c784" },
          { data: nd.pondedVolume || [], yLab: "m³", title: "地表积水体积", color: "#ff8a65" },
          { data: nd.floodingLosses || [], yLab: "", title: "洪泛损失", color: "#ef5350" },
        ];
      } else if (selected.type === "pipe") {
        const ld = dynRes?.links?.[selected.data.id];
        if (ld) configs = [
          { data: ld.flow || [], yLab: "m³/s", title: "流量", color: "#4fc3f7" },
          { data: ld.depth || [], yLab: "m", title: "水深", color: "#81c784" },
          { data: ld.velocity || [], yLab: "m/s", title: "流速", color: "#ff8a65" },
          { data: ld.capacity || [], yLab: "", title: "容量利用率", color: "#ba68c8" },
        ];
      }

      configs.forEach((cfg, i) => {
        const el = refs.current[i]; if (!el) return;
        const ch = core.init(el);
        ch.setOption(makeOpt(cfg.data, cfg.yLab, cfg.title, cfg.color));
        ch.on("click", (params: any) => {
          if (params.dataIndex !== undefined) {
            const ev = new CustomEvent("sandbox:seek", { detail: { step: params.dataIndex } });
            window.dispatchEvent(ev);
          }
        });
      });
    });
  }, [selected.data?.id, selected.type, dynStep, dynRes?.simulationId]);

  return (
    <div className="absolute left-2 right-2 bg-black/96 backdrop-blur rounded-lg border border-gray-700 z-10" style={{ bottom: 128, maxHeight: 340 }}>
      <div className="flex justify-between px-3 py-1.5 text-[10px] text-gray-400 border-b border-gray-800"><span>📈 {selected.data?.id} 时间序列</span><button onClick={onClose} className="text-gray-500 hover:text-gray-200">✕</button></div>
      <div className="grid grid-cols-2 gap-0.5 p-1">
        {[0, 1, 2, 3].map(i => <div key={i} ref={el => { refs.current[i] = el; }} style={{ height: 130 }} />)}
      </div>
    </div>
  );
}
