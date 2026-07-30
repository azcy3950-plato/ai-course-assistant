"use client";

import React, { useEffect, useRef, useState } from "react";

declare const AMap: any;

const BEIJING: [number, number] = [116.4074, 39.9142];

const SUBCATCHMENTS = [
  { id: "S_res",  name: "🏘️ 住宅区", center: [116.4100, 39.9170], half: 0.0045, info: "2.0ha · 不透水70%", color: "#ff9800" },
  { id: "S_com",  name: "🏢 商业区", center: [116.4040, 39.9160], half: 0.0040, info: "1.5ha · 不透水85%", color: "#f44336" },
  { id: "S_park", name: "🌳 公园绿地", center: [116.4080, 39.9110], half: 0.0050, info: "3.0ha · 不透水10%", color: "#4caf50" },
  { id: "S_ind",  name: "🏭 工业区", center: [116.4150, 39.9135], half: 0.0035, info: "1.0ha · 不透水80%", color: "#9c27b0" },
];

const JUNCTIONS = [
  { id: "J_res",  pos: [116.4100, 39.9170], name: "住宅区井" },
  { id: "J_com",  pos: [116.4040, 39.9160], name: "商业区井" },
  { id: "J_park", pos: [116.4080, 39.9110], name: "公园区井" },
  { id: "J_ind",  pos: [116.4150, 39.9135], name: "工业区井" },
  { id: "J_main", pos: [116.4060, 39.9135], name: "主管汇流井" },
];

const OUTFALLS = [
  { id: "O_river", pos: [116.4010, 39.9090], name: "河道出水口" },
];

const PIPES = [
  { from: [116.4100, 39.9170], to: [116.4060, 39.9135], d: 1.2, name: "住宅支管" },
  { from: [116.4040, 39.9160], to: [116.4060, 39.9135], d: 1.5, name: "商业支管" },
  { from: [116.4080, 39.9110], to: [116.4060, 39.9135], d: 1.0, name: "公园支管" },
  { from: [116.4150, 39.9135], to: [116.4060, 39.9135], d: 1.0, name: "工业支管" },
  { from: [116.4060, 39.9135], to: [116.4010, 39.9090], d: 2.0, name: "总干管" },
];

const LAYER_DEFS = [
  { id: "satellite", label: "🛰️ 卫星图", icon: "🛰️" },
  { id: "buildings", label: "🏢 3D建筑", icon: "🏢" },
  { id: "pipes", label: "🔵 管网", icon: "🔵" },
  { id: "subcatchments", label: "🟠 汇水区", icon: "🟠" },
  { id: "nodes", label: "🔹 节点", icon: "🔹" },
];

export default function SandboxPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerGroups = useRef<Record<string, any[]>>({});
  const [loaded, setLoaded] = useState(false);
  const [layers, setLayers] = useState<Record<string, boolean>>({
    satellite: true, buildings: true, pipes: true, subcatchments: true, nodes: true,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).AMap) { initMap(); return; }

    const script = document.createElement("script");
    script.src = "https://webapi.amap.com/maps?v=2.0&key=9c49e8b79be344ae9eb30d7a6c95c15b&plugin=AMap.ControlBar,AMap.Object3D,AMap.Polyline,AMap.Polygon,AMap.Marker";
    script.onload = () => initMap();
    document.body.appendChild(script);
    return () => { script.remove(); if (mapRef.current) { mapRef.current.destroy(); mapRef.current = null; } };
  }, []);

  function initMap() {
    if (!containerRef.current) return;
    const map = new AMap.Map(containerRef.current, {
      mapStyle: "amap://styles/darkblue",
      center: BEIJING,
      zoom: 14,
      pitch: 55,
      viewMode: "3D",
      buildingAnimation: true,
      showBuildingBlock: true,
      layers: [new AMap.TileLayer.Satellite()],
    });
    map.addControl(new AMap.ControlBar({ position: { right: "10px", top: "10px" } }));

    // Wait for map to complete
    map.on("complete", () => {
      drawAll(map);
      setLoaded(true);
    });
    mapRef.current = map;
  }

  function drawAll(map: any) {
    const groups: Record<string, any[]> = {};

    // --- Subcatchments ---
    const scGroup: any[] = [];
    SUBCATCHMENTS.forEach(sc => {
      const [cx, cy] = sc.center;
      const s = sc.half;
      const poly = new AMap.Polygon({
        path: [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]],
        fillColor: sc.color, fillOpacity: 0.25,
        strokeColor: sc.color, strokeWeight: 2, strokeOpacity: 0.8,
        zIndex: 50,
      });
      poly.setMap(map);
      const m = new AMap.Marker({
        position: sc.center,
        offset: new AMap.Pixel(-35, -25),
        content: `<div style="background:rgba(0,0,0,0.75);color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;white-space:nowrap">${sc.name}<br>${sc.info}</div>`,
        zIndex: 51,
      });
      m.setMap(map);
      scGroup.push(poly, m);
    });
    groups["subcatchments"] = scGroup;

    // --- Pipes ---
    const pipeGroup: any[] = [];
    PIPES.forEach(p => {
      const line = new AMap.Polyline({
        path: [p.from, p.to],
        strokeColor: "#00bcd4", strokeWeight: Math.max(3, p.d * 2), strokeOpacity: 0.85,
        strokeStyle: "dashed", zIndex: 60, showDir: true,
      });
      line.setMap(map);
      // Label
      const mx = (p.from[0] + p.to[0]) / 2;
      const my = (p.from[1] + p.to[1]) / 2;
      const m = new AMap.Marker({
        position: [mx, my],
        offset: new AMap.Pixel(-20, -10),
        content: `<div style="background:#006064;color:#00e5ff;padding:1px 6px;border-radius:8px;font-size:9px">${p.name} ${p.d}m</div>`,
        zIndex: 61,
      });
      m.setMap(map);
      pipeGroup.push(line, m);
    });
    groups["pipes"] = pipeGroup;

    // --- Junctions ---
    const nodeGroup: any[] = [];
    JUNCTIONS.forEach(j => {
      const cm = new AMap.CircleMarker({
        center: j.pos, radius: 10,
        fillColor: "#2196f3", fillOpacity: 0.9,
        strokeColor: "#fff", strokeWeight: 2,
        zIndex: 100,
      });
      cm.setMap(map);
      const m = new AMap.Marker({
        position: j.pos,
        offset: new AMap.Pixel(-5, -18),
        content: `<div style="background:#2196f3;color:#fff;padding:1px 6px;border-radius:8px;font-size:9px">${j.id.replace("J_","J")}</div>`,
        zIndex: 101,
      });
      m.setMap(map);
      nodeGroup.push(cm, m);
    });

    // --- Outfall ---
    OUTFALLS.forEach(o => {
      const cm = new AMap.CircleMarker({
        center: o.pos, radius: 12,
        fillColor: "#ff5722", fillOpacity: 0.9,
        strokeColor: "#fff", strokeWeight: 2,
        zIndex: 100,
      });
      cm.setMap(map);
      const m = new AMap.Marker({
        position: o.pos,
        offset: new AMap.Pixel(-5, -22),
        content: `<div style="background:#ff5722;color:#fff;padding:2px 6px;border-radius:8px;font-size:9px">${o.name}</div>`,
        zIndex: 101,
      });
      m.setMap(map);
      nodeGroup.push(cm, m);
    });
    groups["nodes"] = nodeGroup;

    // Buildings and satellite are handled by AMap config, no entities to store
    groups["buildings"] = [];
    groups["satellite"] = [];

    layerGroups.current = groups;
  }

  function toggleLayer(id: string) {
    setLayers(prev => {
      const next = !prev[id];
      const map = mapRef.current;
      if (!map) return { ...prev, [id]: next };

      if (id === "buildings") {
        map.setFeatures(next ? ["bg", "building", "point"] : ["bg", "point"]);
      } else if (id === "satellite") {
        // Toggle satellite tile layer
        const tileLayers = map.getLayers();
        tileLayers.forEach((l: any) => {
          if (l._className === "TileLayer" || l instanceof AMap.TileLayer) {
            next ? l.show() : l.hide();
          }
        });
      } else {
        const group = layerGroups.current[id];
        if (group) group.forEach((o: any) => { next ? o.show() : o.hide(); });
      }
      return { ...prev, [id]: next };
    });
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col relative">
      <div className="absolute top-0 left-0 right-0 bg-black/85 backdrop-blur px-6 py-3 flex items-center justify-between z-10 text-white">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">🌊 城市排水 3D GIS 查看器</span>
          <span className="text-[10px] text-gray-400">高德3D引擎 · 静态沙盘</span>
        </div>
        <div className="flex gap-1">
          {LAYER_DEFS.map(l => (
            <button key={l.id} onClick={() => toggleLayer(l.id)}
              className={"px-3 py-1.5 rounded-lg text-[11px] transition-colors font-medium " +
                (layers[l.id] ? "bg-blue-600 text-white" : "bg-gray-700/50 text-gray-400 hover:bg-gray-600")}>
              {l.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-gray-500">🖱️ 左键旋转 · 右键平移 · 滚轮缩放</span>
      </div>

      <div ref={containerRef} className="flex-1" />

      <div className="absolute bottom-4 right-4 bg-black/85 backdrop-blur rounded-xl border border-gray-700 p-4 text-white text-xs z-10 max-w-xs">
        <div className="font-bold mb-2 text-blue-400 text-sm">📊 场景信息</div>
        <div className="space-y-1.5 text-gray-300">
          <div>📍 北京市中心城区</div>
          <div>🟠 4 个汇水区 · 🔵 5 个检查井</div>
          <div>▬ 5 条排水管道 · 🔴 1 个出水口</div>
          <div className="mt-2 pt-2 border-t border-gray-700">
            <a href="/sandbox/simulate" className="text-cyan-400 hover:underline font-bold">⚡ 进入动态仿真推演 →</a>
          </div>
        </div>
      </div>

      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white z-20">
          <span className="animate-spin mr-2">⏳</span>加载高德 3D 地图...
        </div>
      )}
    </div>
  );
}
