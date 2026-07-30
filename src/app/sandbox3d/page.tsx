"use client";

import React, { useEffect, useRef, useState } from "react";
import { useApp } from "@/contexts/AppContext";

declare const AMap: any;

const BEIJING_CENTER: [number, number] = [116.4074, 39.9142];

const SUBCATCHMENTS: Record<string, any> = {
  S_res:  { name: "🏘️ 住宅区", center: [116.4100,39.9170], area:"2.0ha", imperv:"70%", color:"#ff9800" },
  S_com:  { name: "🏢 商业区", center: [116.4040,39.9160], area:"1.5ha", imperv:"85%", color:"#f44336" },
  S_park: { name: "🌳 公园绿地", center: [116.4080,39.9110], area:"3.0ha", imperv:"10%", color:"#4caf50" },
};
const JUNCTIONS: Record<string, any> = { J1: { name:"J1", pos:[116.4060,39.9140] } };
const OUTFALLS: Record<string, any> = { O1: { name:"O1", pos:[116.4000,39.9100] } };

function drawInfrastructure(map: any, AMapLib: any) {
  const layers: any[] = [];
  Object.entries(SUBCATCHMENTS).forEach(([id, sc]: [string, any]) => {
    const [cx, cy] = sc.center; const s = 0.004;
    const poly = new AMapLib.Polygon({
      path: [[cx-s,cy-s],[cx+s,cy-s],[cx+s,cy+s],[cx-s,cy+s]],
      fillColor: sc.color, fillOpacity: 0.25, strokeColor: sc.color, strokeWeight: 2, strokeOpacity: 0.8, zIndex: 50,
    }); poly.setMap(map); layers.push(poly);
    const m = new AMapLib.Marker({
      position: sc.center, offset: new AMapLib.Pixel(-40, -35),
      content: '<div style="background:rgba(0,0,0,0.75);color:white;padding:2px 8px;border-radius:12px;font-size:11px;white-space:nowrap">'+sc.name+'<br>'+sc.area+' · 不透水'+sc.imperv+'</div>',
    }); m.setMap(map); layers.push(m);
  });
  Object.entries(JUNCTIONS).forEach(([id, j]: [string, any]) => {
    const cm = new AMapLib.CircleMarker({
      center: j.pos, radius: 14, fillColor: "#2196f3", fillOpacity: 0.9, strokeColor: "#fff", strokeWeight: 2, zIndex: 100,
    }); cm.setMap(map); layers.push(cm);
    const lm = new AMapLib.Marker({
      position: j.pos, offset: new AMapLib.Pixel(-8, -22),
      content: '<div style="background:#2196f3;color:white;padding:2px 6px;border-radius:10px;font-size:10px">'+id+' 检查井</div>',
    }); lm.setMap(map); layers.push(lm);
  });
  Object.entries(OUTFALLS).forEach(([id, o]: [string, any]) => {
    const cm = new AMapLib.CircleMarker({
      center: o.pos, radius: 12, fillColor: "#ff5722", fillOpacity: 0.9, strokeColor: "#fff", strokeWeight: 2, zIndex: 100,
    }); cm.setMap(map); layers.push(cm);
    const lm = new AMapLib.Marker({
      position: o.pos, offset: new AMapLib.Pixel(-8, -22),
      content: '<div style="background:#ff5722;color:white;padding:2px 6px;border-radius:10px;font-size:10px">'+id+' 出水口</div>',
    }); lm.setMap(map); layers.push(lm);
  });
  // Pipe
  const from = JUNCTIONS["J1"]; const to = OUTFALLS["O1"];
  if (from && to) {
    const line = new AMapLib.Polyline({
      path: [from.pos, to.pos], strokeColor: "#2196f3", strokeWeight: 4, strokeOpacity: 0.8, strokeStyle: "dashed", zIndex: 70, showDir: true,
    }); line.setMap(map); layers.push(line);
  }
  return layers;
}

export default function Sandbox3DPage() {
  const { state } = useApp();
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [intensity, setIntensity] = useState(50);
  const [swmmResult, setSwmmResult] = useState<any>(null);
  const [animating, setAnimating] = useState(false);
  const [timeStep, setTimeStep] = useState(0);
  const layersRef = useRef<any[]>([]);
  const AMapRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const script = document.createElement("script");
    script.src = "https://webapi.amap.com/maps?v=2.0&key=9c49e8b79be344ae9eb30d7a6c95c15b&plugin=AMap.ControlBar,AMap.Polyline,AMap.Polygon,AMap.CircleMarker";
    script.onload = () => {
      if (!containerRef.current) return;
      const map = new AMap.Map(containerRef.current, {
        mapStyle: "amap://styles/darkblue", center: BEIJING_CENTER, zoom: 14, pitch: 55, viewMode: "3D",
        buildingAnimation: true, showBuildingBlock: true,
        layers: [new AMap.TileLayer.Satellite()],
      });
      map.addControl(new AMap.ControlBar({ position: { right: "10px", top: "10px" } }));
      AMapRef.current = AMap;
      mapRef.current = map;
      layersRef.current = drawInfrastructure(map, AMap);
      map.on("complete", () => setLoaded(true));
    };
    document.body.appendChild(script);
    return () => { script.remove(); };
  }, []);

  const runSimulation = async () => {
    try {
      const res = await fetch("/api/swmm", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({intensity}) });
      const data = await res.json();
      setSwmmResult(data);
      if (!mapRef.current || !data.ok || !AMapRef.current) return;
      const map = mapRef.current; const AM = AMapRef.current;
      const [cx, cy] = BEIJING_CENTER; const s = 0.012;
      const maxD = data.summary?.maxDepth || 0;
      const floodPoly = new AM.Polygon({
        path: [[cx-s,cy-s],[cx+s,cy-s],[cx+s,cy+s],[cx-s,cy+s]],
        fillColor: "#0066ff", fillOpacity: Math.min(0.5, maxD * 1.5),
        strokeColor: "#0033cc", strokeWeight: 2, strokeStyle: "dashed", zIndex: 80,
      });
      floodPoly.setMap(map);
      layersRef.current.push(floodPoly);
      setAnimating(true); setTimeStep(0);
      let step = 0; const total = 30;
      const interval = setInterval(() => { step++; setTimeStep(step); if (step >= total) { clearInterval(interval); setAnimating(false); } }, 150);
    } catch(e) {}
  };

  if (!state.role) return <div className="p-8 text-center">请先登录</div>;

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col relative">
      <div className="absolute top-0 left-0 right-0 bg-black/85 backdrop-blur px-6 py-3 flex items-center gap-4 z-10 text-white">
        <span className="text-sm font-bold">🌊 城市内涝 3D 沙盘</span>
        <label className="text-xs">暴雨:</label>
        <input type="range" min="10" max="200" value={intensity} onChange={e => setIntensity(+e.target.value)} className="w-32" />
        <span className="text-xs w-16">{intensity} mm/h</span>
        <button onClick={runSimulation} disabled={animating} className="px-4 py-1.5 bg-blue-500 text-white text-xs rounded-lg hover:bg-blue-600 disabled:opacity-50">
          {animating ? "推演中 "+timeStep+"/30" : "▶ SWMM 推演"}
        </button>
        <span className="text-xs text-gray-400">🟠汇水区 🔵检查井 🔴出水口 ▬ 管道</span>
      </div>
      <div ref={containerRef} className="flex-1" />
      {!loaded && <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white z-20"><span className="animate-spin mr-2">⏳</span>加载 3D 地图...</div>}
      {swmmResult?.ok && (
        <div className="absolute bottom-4 left-4 bg-black/85 backdrop-blur rounded-xl border border-gray-700 p-4 text-white text-xs z-10">
          <div className="font-bold mb-2 text-blue-400">📊 SWMM ({swmmResult.params?.intensity}mm/h)</div>
          <div>最大水深: <b className="text-blue-300">{swmmResult.summary?.maxDepth?.toFixed(3)}m</b></div>
          <div>模拟步数: <b>{swmmResult.summary?.timesteps}</b></div>
          <div className="text-gray-400 mt-1">🏘️{swmmResult.subcatchments?.S_res?.toFixed(1)} 🏢{swmmResult.subcatchments?.S_com?.toFixed(1)} 🌳{swmmResult.subcatchments?.S_park?.toFixed(1)} m³</div>
          <div className="text-gray-400">🔵J1: {swmmResult.nodes?.J1?.maxD?.toFixed(3)}m</div>
        </div>
      )}
    </div>
  );
}
