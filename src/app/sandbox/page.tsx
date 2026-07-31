"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as THREE from "three";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════
type Node3D = { id: string; x: number; z: number; invert: number; maxD: number; initD: number; ground: number; type: string };
type Pipe3D = { id: string; from: string; to: string; diam: number; length: number; roughness: number; fromInv: number; toInv: number; shape: string; inOffset: number; outOffset: number; verts: [number,number][] };
type SC3D = { id: string; pts: [number,number][]; imperv: number; area: number; outlet: string; width: number; slope: number };

// ═══════════════════════════════════════════════════════════════
// INP PARSER
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const GROUND_COLOR = "#4a4a4a";
const PIPE_COLOR   = "#5f7a8a";
const PIPE_EMI     = "#0a1118";
const NODE_COLOR   = "#5a7282";
const OUTFALL_COLOR = "#b87050";
const SEL_EMI      = "#ffffcc";

function scColor(imp: number) { return imp > 80 ? "#b08070" : imp > 40 ? "#a09580" : "#809870"; }
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

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function SandboxPage() {
  const cr = useRef<HTMLDivElement>(null);
  const scRef = useRef<THREE.Scene | null>(null);
  const camRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rndRef = useRef<THREE.WebGLRenderer | null>(null);
  const dataRef = useRef<any>(null);
  const grpRef = useRef<Record<string,THREE.Group>>({});
  const nMapRef = useRef<Map<string,{g:THREE.Group;iy:number;gy:number}>>(new Map());
  const pMapRef = useRef<Map<string,THREE.Mesh>>(new Map());
  const wMapRef = useRef<Map<string,THREE.Mesh>>(new Map());
  const selRef = useRef<THREE.Object3D | null>(null);
  const spanRef = useRef(300);
  const camState = useRef({ theta:0.45, phi:0.85, dist:500, tx:0, tz:0 });
  const targetRef = useRef(new THREE.Vector3());

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"static"|"dynamic">("static");
  const [selected, setSelected] = useState<any>(null);
  const [hovered, setHovered] = useState<any>(null);
  const [layers, setLayers] = useState<Record<string,boolean>>({ sc:true, pipes:true, nodes:true, ground:true, labels:false });
  const [stats, setStats] = useState({ nodes:0, pipes:0, scs:0 });
  const [ve, setVe] = useState(5);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [isolated, setIsolated] = useState<string | null>(null);
  const [groundOpacity, setGroundOpacity] = useState(0.35);

  // Dynamic
  const [dynI, setDynI] = useState(100);
  const [dynRes, setDynRes] = useState<any>(null);
  const [dynStep, setDynStep] = useState(0);
  const [dynPlay, setDynPlay] = useState(false);
  const [dynSpd, setDynSpd] = useState(1);
  const [dynPhase, setDynPhase] = useState<"config"|"loading"|"ready"|"running"|"paused"|"done">("config");
  const [simId, setSimId] = useState("");
  const [chartOpen, setChartOpen] = useState(false);
  const [showCurves, setShowCurves] = useState(false);

  const tsc = dynRes?.timeStepCount || 0;
  const timestamps: number[] = dynRes?.timestamps || [];
  const curTime = timestamps[dynStep] !== undefined ? fmtTime(timestamps[dynStep]) : "--:--";

  // Flow particles ref
  const particlesRef = useRef<Map<string, THREE.Points>>(new Map());

  // ═══════════════════════════════════════════════════════════════
  // SCENE INIT
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => { (async () => {
    try {
      const r = await fetch("/zijing_inp.inp");
      if (!r.ok) throw new Error("INP 加载失败");
      const data = parseInp(await r.text());
      dataRef.current = data;
      setStats({ nodes: data.nodes.length, pipes: data.pipes.length, scs: data.scs.length });
      if (!cr.current) return;

      const w = cr.current.clientWidth, h = cr.current.clientHeight;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#1c1c24");
      scene.fog = new THREE.Fog("#1c1c24", 200, 1000);
      scRef.current = scene;

      const camera = new THREE.PerspectiveCamera(45, w/h, 0.3, 2500);
      camRef.current = camera;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(w,h); renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      cr.current.appendChild(renderer.domElement);
      rndRef.current = renderer;

      scene.add(new THREE.AmbientLight("#667788", 0.7));
      const sun = new THREE.DirectionalLight("#fff8e8", 2.0);
      sun.position.set(200,350,80); sun.castShadow = true;
      sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.near = 5; sun.shadow.camera.far = 1200;
      sun.shadow.camera.left = -200; sun.shadow.camera.right = 200;
      sun.shadow.camera.top = 200; sun.shadow.camera.bottom = -200;
      scene.add(sun);
      scene.add(new THREE.HemisphereLight("#8899bb","#334455",0.35));

      buildGeometry(scene, data, 5);

      let mnX=Infinity,mxX=-Infinity,mnZ=Infinity,mxZ=-Infinity;
      data.nodes.forEach((n:Node3D)=>{if(n.x<mnX)mnX=n.x;if(n.x>mxX)mxX=n.x;if(n.z<mnZ)mnZ=n.z;if(n.z>mxZ)mxZ=n.z;});
      const cx=(mnX+mxX)/2, cz=(mnZ+mxZ)/2, sp=Math.max(mxX-mnX,mxZ-mnZ,50);
      spanRef.current = sp;
      targetRef.current.set(cx, sp*0.08, cz);
      camState.current = { theta:0.45, phi:0.85, dist:sp*1.3, tx:cx, tz:cz };

      const updateCam = () => {
        const cs = camState.current;
        camera.position.set(cs.tx+cs.dist*Math.sin(cs.phi)*Math.cos(cs.theta), cs.dist*Math.cos(cs.phi)*0.6, cs.tz+cs.dist*Math.sin(cs.phi)*Math.sin(cs.theta));
        camera.lookAt(targetRef.current);
      };
      updateCam();
      setLoaded(true);

      // Orbit controls
      let dragging=false, last={x:0,y:0};
      renderer.domElement.addEventListener("pointerdown",e=>{if(e.button<=1){dragging=true;last={x:e.clientX,y:e.clientY};}});
      renderer.domElement.addEventListener("pointermove",e=>{
        if(dragging){camState.current.theta-=(e.clientX-last.x)*0.005;camState.current.phi=Math.max(0.15,Math.min(1.5,camState.current.phi-(e.clientY-last.y)*0.005));last={x:e.clientX,y:e.clientY};updateCam();return;}
        // Hover detection
        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
        const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(scene.children, true);
        let found: any = null;
        if (hits.length>0) { let obj: any = hits[0].object; while(obj) { if(obj.userData?.type){found=obj;break;} obj=obj.parent; } }
        setHovered(found ? { type: found.userData.type, data: found.userData.data } : null);
        cr.current!.style.cursor = found ? "pointer" : "grab";
      });
      window.addEventListener("pointerup",()=>{dragging=false;});
      renderer.domElement.addEventListener("wheel",e=>{e.preventDefault();camState.current.dist=Math.max(sp*0.2,Math.min(sp*4,camState.current.dist+e.deltaY*0.5));updateCam();});

      // Click selection
      renderer.domElement.addEventListener("click",e=>{
        if (dragging) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
        const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(scene.children, true);
        if (hits.length>0) { let obj: any = hits[0].object; while(obj) { if(obj.userData?.type){ if(selRef.current!==obj){clrSel();selRef.current=obj;hlObj(obj);setSelected({type:obj.userData.type,data:obj.userData.data});} return; } obj=obj.parent; } }
        clrSel(); setSelected(null);
      });

      const animate = () => { requestAnimationFrame(animate); renderer.render(scene, camera); };
      animate();
      const onResize = () => { const w2=cr.current!.clientWidth,h2=cr.current!.clientHeight;camera.aspect=w2/h2;camera.updateProjectionMatrix();renderer.setSize(w2,h2); };
      window.addEventListener("resize",onResize);
      return () => { window.removeEventListener("resize",onResize); renderer.dispose(); };
    } catch(e:any) { setError(e.message); }
  })(); }, []);

  function hlObj(o:THREE.Object3D){o.traverse(c=>{if(c instanceof THREE.Mesh&&c.material&&!(c.material as any)._isW){const m=c.material as any;m.emissive=new THREE.Color(SEL_EMI);m.emissiveIntensity=0.5;}});}
  function clrSel(){if(selRef.current){selRef.current.traverse(c=>{if(c instanceof THREE.Mesh&&c.material&&!(c.material as any)._isW){const m=c.material as any;m.emissive=new THREE.Color("#000");m.emissiveIntensity=0;}});selRef.current=null;}}

  // ═══════════════════════════════════════════════════════════════
  // BUILD GEOMETRY
  // ═══════════════════════════════════════════════════════════════
  function buildGeometry(scene:THREE.Scene, data:any, _ve:number){
    ["ground","sc","pipes","nodes"].forEach(k=>{const o=grpRef.current[k];if(o)scene.remove(o);});
    const grp: Record<string,THREE.Group> = { ground:new THREE.Group(),sc:new THREE.Group(),pipes:new THREE.Group(),nodes:new THREE.Group() };
    Object.values(grp).forEach(g=>scene.add(g)); grpRef.current = grp;
    nMapRef.current.clear(); pMapRef.current.clear(); wMapRef.current.clear();
    particlesRef.current.forEach(ps=>{if(ps.parent)ps.parent.remove(ps);ps.geometry?.dispose();(ps.material as THREE.Material)?.dispose();});
    particlesRef.current.clear();

    let mnX=Infinity,mxX=-Infinity,mnZ=Infinity,mxZ=-Infinity,minE=Infinity,maxE=-Infinity;
    data.nodes.forEach((n:Node3D)=>{if(n.x<mnX)mnX=n.x;if(n.x>mxX)mxX=n.x;if(n.z<mnZ)mnZ=n.z;if(n.z>mxZ)mxZ=n.z;if(n.invert<minE)minE=n.invert;if(n.ground>maxE)maxE=n.ground;});
    const sp = Math.max(mxX-mnX,mxZ-mnZ,50);
    const eY = (e:number)=>(e-minE)*_ve;
    const avgSurf = data.nodes.reduce((s:number,n:Node3D)=>s+n.ground,0)/data.nodes.length;
    const gndY = eY(avgSurf);

    const NODE_R = Math.max(0.35, sp*0.0015);
    const OUTFALL_R = NODE_R*1.5;
    const PIPE_MIN_R = Math.max(0.2, sp*0.001);
    const PIPE_MAX_R = sp*0.005;

    // Ground
    const gs = sp*1.08;
    const gGeom = new THREE.PlaneGeometry(gs,gs); gGeom.rotateX(-Math.PI/2);
    const gMesh = new THREE.Mesh(gGeom, new THREE.MeshStandardMaterial({color:GROUND_COLOR,roughness:0.9,transparent:true,opacity:groundOpacity,depthWrite:true}));
    gMesh.position.y=gndY; gMesh.receiveShadow=true; gMesh.renderOrder=0; gMesh.userData={groundSurface:true};
    grp.ground.add(gMesh);
    const gs2=Math.ceil(sp/12/10)*10||20; const gc=Math.round(gs/gs2);
    const gh = new THREE.GridHelper(gc*gs2,gc,"#555","#3a3a3a"); gh.position.y=gndY+0.02; grp.ground.add(gh);

    // Subcatchments
    data.scs.forEach((sc:SC3D)=>{
      if(sc.pts.length<3)return;
      const sh=new THREE.Shape(); sc.pts.forEach(([x,z],i)=>i===0?sh.moveTo(x,z):sh.lineTo(x,z));
      const color=scColor(sc.imperv);
      const g=new THREE.ExtrudeGeometry(sh,{steps:1,depth:0.015,bevelEnabled:false});
      const f=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness:0.75,transparent:true,opacity:0.14,side:THREE.DoubleSide,depthWrite:false}));
      f.rotation.x=-Math.PI/2; f.position.y=gndY+0.04; f.renderOrder=1;
      f.userData={type:"subcatchment",data:{id:sc.id,area:sc.area,imperv:sc.imperv,outlet:sc.outlet,width:sc.width,slope:sc.slope,vertices:sc.pts.length}};
      grp.sc.add(f);
      if(sc.pts.length<=200){const ep=sc.pts.map(([x,z])=>new THREE.Vector3(x,gndY+0.05,z));ep.push(ep[0].clone());const eg=new THREE.BufferGeometry().setFromPoints(ep);grp.sc.add(new THREE.Line(eg,new THREE.LineBasicMaterial({color,transparent:true,opacity:0.25,depthTest:true})));}
    });

    // Nodes
    data.nodes.forEach((n:Node3D)=>{
      const g=new THREE.Group(); const iy=eY(n.invert),gy=eY(n.ground); const sh=Math.max(0.15,gy-iy);
      const isO=n.type==="outfall"; const r=isO?OUTFALL_R:NODE_R;
      const sg=new THREE.CylinderGeometry(r,r,sh,12);
      const sm=new THREE.Mesh(sg,new THREE.MeshStandardMaterial({color:isO?OUTFALL_COLOR:NODE_COLOR,roughness:0.35,metalness:0.08,emissive:isO?"#1a0800":"#060c10",emissiveIntensity:isO?0.15:0.05}));
      sm.position.y=iy+sh/2; sm.castShadow=true; sm.receiveShadow=true; g.add(sm);
      const tg=new THREE.TorusGeometry(r*1.12,r*0.22,8,10);
      const tm=new THREE.Mesh(tg,new THREE.MeshStandardMaterial({color:isO?"#c87858":"#6a8898",emissive:isO?"#1a0800":"#060c10",emissiveIntensity:0.2,roughness:0.2}));
      tm.position.y=gy; tm.rotation.x=Math.PI/2; g.add(tm);
      g.position.set(n.x,0,n.z);
      g.userData={type:"node",data:{id:n.id,type:n.type,invert:n.invert,ground:n.ground,maxDepth:n.maxD,initDepth:n.initD}};
      grp.nodes.add(g); nMapRef.current.set(n.id,{g,iy,gy});
    });

    // Pipes
    data.pipes.forEach((p:Pipe3D)=>{
      const fn=data.nodes.find((nn:Node3D)=>nn.id===p.from), tn=data.nodes.find((nn:Node3D)=>nn.id===p.to);
      if(!fn||!tn)return;
      const fy=eY(fn.invert+0.05), ty=eY(tn.invert+0.05);
      const vr=Math.max(PIPE_MIN_R,Math.min(PIPE_MAX_R,p.diam*0.55));
      const path:THREE.Vector3[]=[new THREE.Vector3(fn.x,fy,fn.z)];
      p.verts.forEach(([vx,vz])=>path.push(new THREE.Vector3(vx,fy,vz)));
      path.push(new THREE.Vector3(tn.x,ty,tn.z));
      if(path.length<2)return;
      const curve=new THREE.CatmullRomCurve3(path);
      const tg=new THREE.TubeGeometry(curve,Math.max(8,path.length*3),vr,10,false);
      const tm=new THREE.Mesh(tg,new THREE.MeshStandardMaterial({color:PIPE_COLOR,roughness:0.4,metalness:0.1,emissive:PIPE_EMI,emissiveIntensity:0.06}));
      tm.castShadow=true; tm.receiveShadow=true;
      tm.userData={type:"pipe",data:{id:p.id,from:p.from,to:p.to,diam:p.diam,length:p.length,roughness:p.roughness,shape:p.shape,inOffset:p.inOffset,outOffset:p.outOffset,vertCount:p.verts.length}};
      // Invisible wider hit target
      const ht=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(6,path.length*2),vr*2.5,8,false),new THREE.MeshBasicMaterial({visible:false,depthTest:false}));
      ht.userData={type:"pipe",data:tm.userData.data}; ht.name="hitTarget";
      tm.add(ht);
      grp.pipes.add(tm); pMapRef.current.set(p.id,tm);
    });
  }

  // Rebuild
  const rebuild = useCallback((_ve:number)=>{const s=scRef.current,d=dataRef.current;if(s&&d)buildGeometry(s,d,_ve);},[]);

  // Layer toggle
  const toggleLayer = (id:string)=>{setLayers(p=>{const n=!p[id];const g=grpRef.current[id];if(g)g.visible=n;return{...p,[id]:n};});};

  // ═══════════════════════════════════════════════════════════════
  // VIEW PRESETS
  // ═══════════════════════════════════════════════════════════════
  const flyTo = (view:string) => {
    const d=dataRef.current; if(!d)return;
    let mnX=Infinity,mxX=-Infinity,mnZ=Infinity,mxZ=-Infinity;
    d.nodes.forEach((n:Node3D)=>{if(n.x<mnX)mnX=n.x;if(n.x>mxX)mxX=n.x;if(n.z<mnZ)mnZ=n.z;if(n.z>mxZ)mxZ=n.z;});
    const cx=(mnX+mxX)/2,cz=(mnZ+mxZ)/2,sp=Math.max(mxX-mnX,mxZ-mnZ,50);
    const presets:Record<string,any>={panorama:{theta:0.45,phi:0.85,dist:sp*1.3,tx:cx,tz:cz},topdown:{theta:0,phi:0.06,dist:sp*1.05,tx:cx,tz:cz},underground:{theta:0.35,phi:1.1,dist:sp*0.5,tx:cx,tz:cz}};
    const p=presets[view]||presets.panorama;
    const start={...camState.current};
    const end={...p};
    const t0=performance.now(); const dur=500;
    const animate=()=>{
      const el=performance.now()-t0; const t2=Math.min(1,el/dur); const ease=1-Math.pow(1-t2,3);
      camState.current.theta=start.theta+(end.theta-start.theta)*ease;
      camState.current.phi=start.phi+(end.phi-start.phi)*ease;
      camState.current.dist=start.dist+(end.dist-start.dist)*ease;
      camState.current.tx=start.tx+(end.tx-start.tx)*ease;
      camState.current.tz=start.tz+(end.tz-start.tz)*ease;
      targetRef.current.set(camState.current.tx,sp*0.08,camState.current.tz);
      if(camRef.current){const cs=camState.current;camRef.current.position.set(cs.tx+cs.dist*Math.sin(cs.phi)*Math.cos(cs.theta),cs.dist*Math.cos(cs.phi)*0.6,cs.tz+cs.dist*Math.sin(cs.phi)*Math.sin(cs.theta));camRef.current.lookAt(targetRef.current);}
      if(t2<1)requestAnimationFrame(animate);
    };
    animate();
    if(view==="underground"){["ground","sc"].forEach(k=>{if(grpRef.current[k])grpRef.current[k].visible=false;});}
    else{["ground","sc"].forEach(k=>{if(grpRef.current[k])grpRef.current[k].visible=layers[k];});}
  };

  const focusObject = (obj:any)=>{
    if(!obj)return;
    const d=dataRef.current; if(!d)return;
    let tx=0,tz=0;
    if(obj.type==="node"){const n=d.nodes.find((nn:Node3D)=>nn.id===obj.data.id);if(n){tx=n.x;tz=n.z;}}
    else if(obj.type==="pipe"){const fn=d.nodes.find((nn:Node3D)=>nn.id===obj.data.from);const tn=d.nodes.find((nn:Node3D)=>nn.id===obj.data.to);if(fn&&tn){tx=(fn.x+tn.x)/2;tz=(fn.z+tn.z)/2;}}
    targetRef.current.set(tx,spanRef.current*0.08,tz);
    camState.current.dist=spanRef.current*0.4; camState.current.tx=tx; camState.current.tz=tz;
    if(camRef.current){const cs=camState.current;camRef.current.position.set(cs.tx+cs.dist*Math.sin(cs.phi)*Math.cos(cs.theta),cs.dist*Math.cos(cs.phi)*0.6,cs.tz+cs.dist*Math.sin(cs.phi)*Math.sin(cs.theta));camRef.current.lookAt(targetRef.current);}
  };

  // Search
  const doSearch = (q:string)=>{
    setSearchQuery(q);
    if(!q.trim()||!dataRef.current){setSearchResults([]);return;}
    const d=dataRef.current; const ql=q.toLowerCase();
    const r:any[]=[];
    d.nodes.forEach((n:Node3D)=>{if(n.id.toLowerCase().includes(ql))r.push({type:"node",data:{id:n.id,type:n.type,invert:n.invert,ground:n.ground}});});
    d.pipes.forEach((p:Pipe3D)=>{if(p.id.toLowerCase().includes(ql)||p.from.toLowerCase().includes(ql)||p.to.toLowerCase().includes(ql))r.push({type:"pipe",data:{id:p.id,from:p.from,to:p.to,diam:p.diam}});});
    setSearchResults(r.slice(0,20));
  };

  const locateResult = (r:any)=>{setSelected(r);focusObject(r);};

  // Isolate
  const isolateObject = (obj:any)=>{
    if(!obj||!dataRef.current||!grpRef.current.nodes||!grpRef.current.pipes)return;
    setIsolated(obj.data.id);
    const nGrp=grpRef.current.nodes,pGrp=grpRef.current.pipes;
    nGrp.children.forEach((g:any)=>{g.visible=g.userData?.data?.id===obj.data.id;});
    pGrp.children.forEach((m:any)=>{const d2=m.userData?.data;m.visible=d2?.id===obj.data.id||d2?.from===obj.data.id||d2?.to===obj.data.id;});
  };

  const resetIsolation = ()=>{
    setIsolated(null);
    if(grpRef.current.nodes)grpRef.current.nodes.children.forEach((g:any)=>{g.visible=true;});
    if(grpRef.current.pipes)grpRef.current.pipes.children.forEach((m:any)=>{m.visible=true;});
  };

  // ═══════════════════════════════════════════════════════════════
  // DYNAMIC MODE
  // ═══════════════════════════════════════════════════════════════
  const loadSim = useCallback(async()=>{
    setDynPhase("loading");setDynStep(0);
    try{
      const ctrl=new AbortController();const tid=setTimeout(()=>ctrl.abort(),90000);
      const res=await fetch("/api/swmm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({intensity:dynI}),signal:ctrl.signal});
      clearTimeout(tid);const d=await res.json();
      if(!d.ok)throw new Error(d.error||"API error");
      setDynRes(d);setDynPhase("ready");setSimId(d.simulationId||"");
    }catch(e:any){setDynPhase("config");if(e.name!=="AbortError")alert("仿真加载失败: "+e.message);}
  },[dynI]);

  const clearDyn = useCallback(()=>{
    wMapRef.current.forEach(m=>{if(m.parent)m.parent.remove(m);m.geometry?.dispose();(m.material as THREE.Material)?.dispose();});
    wMapRef.current.clear();
    pMapRef.current.forEach(m=>{if(m.material){const mat=m.material as THREE.MeshStandardMaterial;mat.color.set(PIPE_COLOR);mat.emissive.set(PIPE_EMI);mat.emissiveIntensity=0.06;}});
  },[]);

  useEffect(()=>{if(!dynPlay||dynPhase!=="running"||tsc===0)return;const t=setInterval(()=>{setDynStep(p=>{const n=p+1;if(n>=tsc-1){setDynPlay(false);setDynPhase("done");return tsc-1;}return n;});},140/dynSpd);return()=>clearInterval(t);},[dynPlay,dynSpd,dynPhase,tsc]);

  // Update dynamic visuals
  useEffect(()=>{
    if(!dynRes?.nodes||!dataRef.current)return;
    const ts=dynRes;const nodeData=ts.nodes;const linkData=ts.links;
    let minE=Infinity;dataRef.current.nodes.forEach((n:Node3D)=>{if(n.invert<minE)minE=n.invert;});
    const eY=(e:number)=>(e-minE)*ve;

    nMapRef.current.forEach(({g,iy,gy},nid)=>{
      const nd=nodeData[nid];const d2=nd?.depth;const depth=(d2&&dynStep<d2.length)?d2[dynStep]:0;
      const ponding=nd?.pondedVolume?.[dynStep]??0;
      const nodeInfo=dataRef.current.nodes.find((n:Node3D)=>n.id===nid);
      const isOverflow=nodeInfo&&depth>(nodeInfo.maxD||99);

      let wm=wMapRef.current.get(nid);
      if(depth<0.003){if(wm)wm.visible=false;return;}
      if(!wm){const wg=new THREE.CylinderGeometry(0.22,0.22,1,8);const wmt=new THREE.MeshStandardMaterial({color:"#3388cc",roughness:0.1,metalness:0.05,emissive:"#001122",emissiveIntensity:0.2,transparent:true,opacity:0.7,depthWrite:true});(wmt as any)._isW=true;wm=new THREE.Mesh(wg,wmt);wm.position.set(0,iy,0);(wm as any).userData={water:true};g.add(wm);wMapRef.current.set(nid,wm);}
      wm.visible=true;const wh=Math.max(0.03,depth*ve);wm.scale.y=wh;wm.position.y=iy+wh/2;
      const m=wm.material as THREE.MeshStandardMaterial;
      if(ponding>0.01||isOverflow){m.color.set("#e04040");m.emissive.set("#300000");m.emissiveIntensity=0.4;}
      else{const ratio=Math.min(1,depth/(ts.summary?.maxDepth?.value||1));m.color.set(new THREE.Color().setHSL(0.57-ratio*0.12,0.7,0.35+ratio*0.2));m.emissive.set("#001122");m.emissiveIntensity=0.15+ratio*0.2;}
      // Overflow ring
      const rings=g.children.filter(c=>(c as any).userData?.ofRing);
      rings.forEach(c=>g.remove(c));
      if(ponding>0.01){const rg=new THREE.TorusGeometry(0.3,0.05,8,10);const rm=new THREE.Mesh(rg,new THREE.MeshStandardMaterial({color:"#e04040",emissive:"#300000",emissiveIntensity:0.6,roughness:0.1}));rm.position.y=gy;rm.rotation.x=Math.PI/2;(rm as any).userData={ofRing:true};g.add(rm);}
    });

    // Pipe colors
    pMapRef.current.forEach((mesh,pid)=>{
      const ld=linkData[pid];const flows=ld?.flow;const flow=(flows&&dynStep<flows.length)?flows[dynStep]:0;
      const cap=ld?.capacity;const capacity=(cap&&dynStep<cap.length)?cap[dynStep]:0;
      const absFlow=Math.abs(flow);const mat=mesh.material as THREE.MeshStandardMaterial;
      if(absFlow<0.0005){mat.color.set(PIPE_COLOR);mat.emissive.set(PIPE_EMI);mat.emissiveIntensity=0.06;return;}
      const maxF=ts.summary?.maxFlow?.value||0.1;const ratio=Math.min(1,absFlow/maxF);
      const isFull=capacity>0.95;
      mat.color.set(new THREE.Color().setHSL(isFull?0.05:0.55-ratio*0.35,0.7,0.4+ratio*0.25));
      mat.emissive.set(new THREE.Color().setHSL(isFull?0.05:0.55-ratio*0.35,0.7,0.08+ratio*0.12));
      mat.emissiveIntensity=isFull?0.5:0.06+ratio*0.4;
    });
  },[dynStep,dynRes,ve]);

  useEffect(()=>{if(mode!=="dynamic")clearDyn();},[mode,clearDyn]);

  // ═══════════════════════════════════════════════════════════════
  // COMPUTED
  // ═══════════════════════════════════════════════════════════════
  const curNodeData = (mode==="dynamic"&&selected?.type==="node"&&dynRes?.nodes)?dynRes.nodes[selected.data.id]:null;
  const curLinkData = (mode==="dynamic"&&selected?.type==="pipe"&&dynRes?.links)?dynRes.links[selected.data.id]:null;

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-black relative overflow-hidden">
      {/*═══ TOP BAR ═══*/}
      <div className="absolute top-0 left-0 right-0 z-20 bg-black/95 backdrop-blur border-b border-gray-800 flex items-center px-3" style={{height:52}}>
        <span className="font-bold text-gray-200 text-sm mr-4">🌊 紫荆雅园</span>
        <div className="flex bg-gray-800 rounded-lg p-0.5 mr-3">
          <button onClick={()=>{setMode("static");clearDyn();}} className={"px-4 py-1.5 rounded-md font-bold text-sm "+(mode==="static"?"bg-blue-600 text-white":"text-gray-400 hover:text-white")}>📐 静态沙盘</button>
          <button onClick={()=>setMode("dynamic")} className={"px-4 py-1.5 rounded-md font-bold text-sm "+(mode==="dynamic"?"bg-cyan-600 text-white":"text-gray-400 hover:text-white")}>▶ 动态推演</button>
        </div>
        <div className="h-5 w-px bg-gray-600 mr-3" />
        <button onClick={()=>flyTo("panorama")} className="px-2 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 rounded text-gray-300 mr-1" title="全景">🏠</button>
        <button onClick={()=>flyTo("topdown")} className="px-2 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 rounded text-gray-300 mr-1" title="俯视">🔽</button>
        <button onClick={()=>flyTo("underground")} className="px-2 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 rounded text-gray-300 mr-3" title="地下">⛏</button>
        <button onClick={()=>{if(cr.current){if(document.fullscreenElement)document.exitFullscreen();else cr.current.requestFullscreen();}}} className="px-2 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 rounded text-gray-300 mr-3" title="全屏">⛶</button>
        <div className="h-5 w-px bg-gray-600 mr-3" />
        <span className="text-[10px] text-gray-500 mr-2">垂直:</span>
        {[1,3,5,8].map(v=>(<button key={v} onClick={()=>{setVe(v);rebuild(v);}} className={"px-1.5 py-0.5 rounded text-[10px] mr-0.5 "+(ve===v?"bg-blue-700":"bg-gray-800 text-gray-400")}>{v}×</button>))}
        {mode==="dynamic" && simId && <span className="ml-auto text-[9px] text-gray-600 truncate max-w-[200px]" title={simId}>{simId.slice(0,8)}</span>}
        <span className="ml-auto text-[9px] text-gray-500">{stats.nodes}节点·{stats.pipes}管·{stats.scs}汇水区</span>
      </div>

      {/*═══ LEFT PANEL ═══*/}
      <div className={"absolute left-0 z-20 bg-black/92 backdrop-blur border-r border-gray-800 transition-all duration-200 flex flex-col "+(leftOpen?"w-[240px]":"w-[32px]")} style={{top:52,bottom:0}}>
        <button onClick={()=>setLeftOpen(!leftOpen)} className="absolute -right-5 top-2 w-5 h-10 bg-gray-800 rounded-r text-[10px] text-gray-400 hover:text-white flex items-center justify-center">{leftOpen?"◀":"▶"}</button>
        {leftOpen && <div className="p-2 overflow-y-auto flex-1">
          <div className="text-[11px] font-bold text-gray-400 mb-2">{mode==="static"?"图层 & 搜索":"图例 & 导航"}</div>
          {/* Layer toggles */}
          <div className="space-y-1 mb-3">
            {[{id:"ground",l:"地表参考面"},{id:"sc",l:"汇水区"},{id:"pipes",l:"管道"},{id:"nodes",l:"节点"}].map(({id,l})=>(
              <label key={id} className="flex items-center gap-2 text-[11px] text-gray-400 hover:text-gray-200 cursor-pointer">
                <input type="checkbox" checked={layers[id]} onChange={()=>toggleLayer(id)} className="accent-cyan-500" />{l}
              </label>
            ))}
          </div>
          {/* Ground opacity */}
          <div className="mb-3"><div className="text-[10px] text-gray-500 mb-1">地表透明度</div><input type="range" min="10" max="100" value={Math.round(groundOpacity*100)} onChange={e=>{const v=+e.target.value/100;setGroundOpacity(v);const g=grpRef.current.ground;if(g){g.children.forEach(c=>{if((c as any).userData?.groundSurface&&c instanceof THREE.Mesh){const m=c.material as THREE.MeshStandardMaterial;m.opacity=v;}});}}} className="w-full accent-cyan-500 h-1.5" /></div>
          {/* Search */}
          <div className="mb-2"><input type="text" placeholder="搜索节点/管道…" value={searchQuery} onChange={e=>doSearch(e.target.value)} className="w-full bg-gray-800 rounded px-2 py-1 text-[11px] text-gray-200 border border-gray-700 focus:border-cyan-600 outline-none" /></div>
          {searchResults.length>0 && <div className="space-y-0.5 max-h-[200px] overflow-y-auto mb-2">{searchResults.map((r,i)=>(<div key={i} onClick={()=>locateResult(r)} className="text-[10px] text-gray-400 hover:text-white hover:bg-gray-800 rounded px-1.5 py-0.5 cursor-pointer truncate">{r.type==="node"?"🔹":"▬"} {r.data.id}</div>))}</div>}
          {/* Isolate */}
          {isolated && <button onClick={resetIsolation} className="w-full text-[10px] bg-red-900 hover:bg-red-800 rounded px-2 py-1 text-gray-300 mb-2">恢复完整模型</button>}
          {selected && !isolated && <button onClick={()=>isolateObject(selected)} className="w-full text-[10px] bg-gray-800 hover:bg-gray-700 rounded px-2 py-1 text-gray-400 mb-2">🔍 隔离查看</button>}
          {/* Legend */}
          {mode==="dynamic" && dynRes && (<div className="text-[10px] text-gray-500 mt-2 space-y-1">
            <div className="font-bold text-[11px] text-gray-400">📊 仿真概览</div>
            <div>最大水深: {dynRes.summary?.maxDepth?.value?.toFixed(2)}m @ {dynRes.summary?.maxDepth?.nodeId}</div>
            <div>最大流量: {dynRes.summary?.maxFlow?.value?.toFixed(2)} @ {dynRes.summary?.maxFlow?.linkId}</div>
            <div>活跃: {dynRes.summary?.activeNodes}n / {dynRes.summary?.activeLinks}l</div>
          </div>)}
          <div className="text-[9px] text-gray-600 mt-3">当前地面为根据节点地表高程计算的工程参考平面，不代表真实DEM地形。</div>
        </div>}
      </div>

      {/*═══ THREE.JS SCENE ═══*/}
      <div ref={cr} className="flex-1" />

      {/*═══ RIGHT DRAWER ═══*/}
      <div className={"absolute right-0 z-20 bg-black/92 backdrop-blur border-l border-gray-800 transition-all duration-200 flex flex-col overflow-y-auto "+(rightOpen?"w-[340px]":"w-[32px]")} style={{top:52,bottom:mode==="dynamic"&&dynRes?.ok?"132px":"0"}}>
        <button onClick={()=>setRightOpen(!rightOpen)} className="absolute -left-5 top-2 w-5 h-10 bg-gray-800 rounded-l text-[10px] text-gray-400 hover:text-white flex items-center justify-center">{rightOpen?"▶":"◀"}</button>
        {!rightOpen && <div className="mt-8 text-[10px] text-gray-600 text-center">属性</div>}
        {rightOpen && <div className="p-2.5">
          {/* Static properties */}
          {mode==="static" && selected && (<>
            <div className="text-xs font-bold text-gray-300 mb-2 flex justify-between">
              <span>{{node:"🔹 节点",pipe:"▬ 管道",subcatchment:"▨ 汇水区"}[selected.type as string]||selected.type}</span>
              <button onClick={()=>{clrSel();setSelected(null);}} className="text-gray-500 hover:text-gray-300">✕</button>
            </div>
            <div className="space-y-0.5">
              {Object.entries(selected.data).map(([k,v]:[string,any])=>(<div key={k} className="flex justify-between text-[11px]"><span className="text-gray-500">{chLabel(k)}</span><span className="text-gray-200 text-right ml-2">{k==="type"?v==="outfall"?"出水口":"检查井":fmtVal(k,v)}</span></div>))}
            </div>
          </>)}
          {mode==="static" && !selected && <div className="text-[11px] text-gray-600 text-center py-8">点击对象查看属性</div>}

          {/* Dynamic config/properties */}
          {mode==="dynamic" && (<>
            <div className="text-xs font-bold text-gray-300 mb-2">{{config:"⚙️ 场景配置",loading:"⏳ 仿真中…",ready:"📊 就绪",running:"🔵 运行中",paused:"⏸ 暂停",done:"✅ 完成"}[dynPhase]}</div>

            {(dynPhase==="config"||dynPhase==="ready"||dynPhase==="done")&&(<div className="space-y-2">
              <div><div className="flex justify-between text-[11px]"><span className="text-gray-500">降雨倍率</span><span className="text-cyan-400 font-bold">{dynI}%</span></div><input type="range" min="10" max="300" value={dynI} onChange={e=>setDynI(+e.target.value)} className="w-full accent-cyan-500 mt-0.5 h-1.5" /></div>
              {dynRes && <div className="text-[10px] text-gray-500">时间步: {dynRes.timeStepCount} | {dynRes.metadata?.startTime?.slice(0,16)} → {dynRes.metadata?.endTime?.slice(11,16)}</div>}
              <button onClick={loadSim} className="w-full py-2 bg-cyan-800 rounded font-bold text-xs hover:bg-cyan-700">{dynRes?"🔄 重新仿真":"📊 开始推演"}</button>
              {dynPhase==="ready"&&<button onClick={()=>{setDynPhase("running");setDynPlay(true);setDynStep(0);}} className="w-full py-2 bg-green-800 rounded font-bold text-xs hover:bg-green-700">▶ 播放</button>}
              {dynPhase==="done"&&<button onClick={()=>{setDynStep(0);setDynPlay(true);setDynPhase("running");}} className="w-full py-2 bg-green-800 rounded font-bold text-xs hover:bg-green-700">🔄 重新播放</button>}
            </div>)}

            {(dynPhase==="running"||dynPhase==="paused")&&(<div className="space-y-2">
              <div className="flex justify-between text-[11px]"><span className="text-gray-500">当前时间</span><span className="text-gray-200 font-mono">{curTime}</span></div>
              <div className="flex justify-between text-[11px]"><span className="text-gray-500">当前步</span><span className="text-gray-200">{dynStep+1}/{tsc}</span></div>
            </div>)}

            {dynPhase==="loading"&&<div className="text-center py-4"><div className="animate-spin text-lg mb-1">⏳</div><div className="text-[10px] text-gray-400">运行 SWMM 仿真…</div></div>}

            {/* Dynamic object properties */}
            {selected&&(dynPhase==="running"||dynPhase==="paused"||dynPhase==="done")&&(<div className="border-t border-gray-700 mt-2 pt-2 space-y-0.5">
              <div className="text-xs font-bold text-gray-300 mb-1">{{node:"🔹 "+selected.data.id,pipe:"▬ "+selected.data.id}[selected.type as string]}</div>
              {selected.type==="node"&&curNodeData&&(<>
                <DynProp l="当前水深" v={curNodeData.depth?.[dynStep]??0} u="m" />
                <DynProp l="总入流" v={curNodeData.totalInflow?.[dynStep]??0} u="m³/s" />
                <DynProp l="地表积水体积" v={curNodeData.pondedVolume?.[dynStep]??0} u="m³" warn={(curNodeData.pondedVolume?.[dynStep]??0)>0.01} />
                <DynProp l="洪泛损失" v={curNodeData.floodingLosses?.[dynStep]??0} u="" warn={(curNodeData.floodingLosses?.[dynStep]??0)>0.01} />
              </>)}
              {selected.type==="pipe"&&curLinkData&&(<>
                <DynProp l="当前流量" v={curLinkData.flow?.[dynStep]??0} u="m³/s" />
                <DynProp l="当前流速" v={curLinkData.velocity?.[dynStep]??0} u="m/s" />
                <DynProp l="水深" v={curLinkData.depth?.[dynStep]??0} u="m" />
                <DynProp l="充满度" v={(curLinkData.depthFraction?.[dynStep]??0)*100} u="%" pct />
                <DynProp l="容量利用率" v={curLinkData.capacity?.[dynStep]??0} u="" />
                <DynProp l="流向" l2={(curLinkData.flow?.[dynStep]??0)>=0?selected.data.to:selected.data.from} dir />
              </>)}
              <button onClick={()=>setShowCurves(!showCurves)} className="w-full text-[10px] bg-gray-800 hover:bg-gray-700 rounded px-2 py-1 text-gray-400 mt-1">📈 {showCurves?"收起曲线":"展开曲线"}</button>
            </div>)}
          </>)}
        </div>}
      </div>

      {/*═══ BOTTOM BAR (dynamic only) ═══*/}
      {mode==="dynamic"&&dynRes?.ok&&(dynPhase==="running"||dynPhase==="paused"||dynPhase==="done")&&tsc>0&&(
        <div className="absolute bottom-0 left-0 right-0 bg-black/95 backdrop-blur border-t border-gray-800 z-20" style={{height:132}}>
          <div className="flex flex-col gap-1.5 px-4 pt-2">
            <div className="flex items-center gap-1.5 justify-center">
              <Btn icon="⏮" onClick={()=>setDynStep(0)} title="重置" />
              <Btn icon="◀◀" onClick={()=>setDynStep(s=>Math.max(0,s-10))} title="后退10步" />
              <Btn icon="◀" onClick={()=>setDynStep(s=>Math.max(0,s-1))} title="上一步" />
              {dynPhase==="running"
                ?<Btn icon="⏸" onClick={()=>{setDynPlay(false);setDynPhase("paused");}} title="暂停" cls="bg-yellow-800 hover:bg-yellow-700" />
                :<Btn icon="▶" onClick={()=>{if(dynStep>=tsc-1)setDynStep(0);setDynPlay(true);setDynPhase("running");}} title="播放" cls="bg-green-800 hover:bg-green-700" />
              }
              <Btn icon="▶▶" onClick={()=>setDynStep(s=>Math.min(tsc-1,s+10))} title="前进10步" />
              <Btn icon="⏭" onClick={()=>setDynStep(tsc-1)} title="跳至末尾" />
              <Btn icon="⏹" onClick={()=>{setDynPlay(false);setDynPhase("done");}} title="停止" cls="bg-red-900 hover:bg-red-800" />
              <div className="w-3" />
              <span className="text-[11px] text-gray-400 font-mono w-12 text-center">{curTime}</span>
              <span className="text-[10px] text-gray-500">{dynStep+1}/{tsc}</span>
              <div className="w-2" />
              {[0.5,1,2,5].map(s=>(<button key={s} onClick={()=>setDynSpd(s)} className={"px-2 py-0.5 rounded text-[10px] "+(dynSpd===s?"bg-cyan-800 text-white":"bg-gray-800 text-gray-400 hover:text-white")}>{s}×</button>))}
            </div>
            <input type="range" min={0} max={tsc-1} value={dynStep} onChange={e=>{setDynStep(+e.target.value);if(dynPlay){setDynPlay(false);setDynPhase("paused");}}} className="w-full h-2 appearance-none bg-gray-800 rounded-full cursor-pointer [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full" />
          </div>
        </div>
      )}

      {/*═══ CURVES PANEL ═══*/}
      {mode==="dynamic"&&showCurves&&selected&&dynRes?.ok&&tsc>0&&(
        <CurvePanel selected={selected} dynRes={dynRes} dynStep={dynStep} timestamps={timestamps} curTime={curTime} tsc={tsc} onClose={()=>setShowCurves(false)} />
      )}

      {/*═══ OVERLAYS ═══*/}
      {!loaded&&!error&&<div className="absolute inset-0 flex items-center justify-center bg-gray-950 z-30"><span className="animate-spin mr-2">⏳</span><span className="text-sm text-gray-300">加载 SWMM 模型…</span></div>}
      {error&&<div className="absolute inset-0 flex items-center justify-center bg-gray-950 z-30"><div className="text-center bg-red-900/60 rounded-xl p-6 max-w-md"><div className="text-2xl mb-2">⚠️</div><div className="text-sm mb-1 text-gray-200">{error}</div><button onClick={()=>window.location.reload()} className="mt-3 px-4 py-1.5 bg-red-800 rounded text-xs hover:bg-red-700 text-white">刷新</button></div></div>}

      {/* Hover tooltip */}
      {hovered && <div className="absolute z-30 pointer-events-none bg-black/88 backdrop-blur rounded px-2 py-1 text-[10px] text-gray-200 border border-gray-700" style={{left:16,top:70}}>{{node:"🔹 节点",pipe:"▬ 管道",subcatchment:"▨ 汇水区"}[hovered.type as string]||hovered.type} {hovered.data?.id}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

function Btn({icon,onClick,title,cls}:{icon:string;onClick:()=>void;title:string;cls?:string}){
  return <button onClick={onClick} title={title} className={"px-2 py-1 rounded text-xs font-bold "+(cls||"bg-gray-800 hover:bg-gray-700 text-gray-300")}>{icon}</button>;
}

function DynProp({l,v,u,warn,pct,dir,l2}:{l:string;v?:number;u?:string;warn?:boolean;pct?:boolean;dir?:boolean;l2?:string}){
  if(dir) return <div className="flex justify-between text-[11px]"><span className="text-gray-500">{l}</span><span className="text-gray-200">→ {l2}</span></div>;
  const cls = warn ? "text-red-400" : "text-gray-200";
  return <div className="flex justify-between text-[11px]"><span className="text-gray-500">{l}</span><span className={cls}>{pct?v.toFixed(0)+u:v.toFixed(3)+(u?" "+u:"")}</span></div>;
}

// Simple ECharts wrapper (inline to avoid extra files)
let echartsCore: any = null;
async function getEcharts() {
  if (echartsCore) return echartsCore;
  const [core, charts, components, renderer] = await Promise.all([
    import("echarts/core"), import("echarts/charts"), import("echarts/components"), import("echarts/renderers")
  ]);
  core.use([charts.LineChart, components.GridComponent, components.TooltipComponent, components.LegendComponent, renderer.CanvasRenderer]);
  echartsCore = core;
  return core;
}

function CurvePanel({selected,dynRes,dynStep,timestamps,curTime,tsc,onClose}:any){
  const chartRef = useRef<HTMLDivElement>(null);
  const [ready,setReady] = useState(false);

  useEffect(()=>{
    let cancelled = false;
    getEcharts().then(core=>{
      if(cancelled||!chartRef.current)return;
      const ts = timestamps.map((t:number)=>t.toFixed(1)+"h");
      const mark = dynStep<ts.length?[{xAxis:ts[dynStep]}]:[];
      let data:number[]=[]; let yLabel=""; let title="";
      if(selected.type==="node"){const nd=dynRes?.nodes?.[selected.data.id];if(nd){data=nd.depth||[];yLabel="m";title="水深";}}
      else if(selected.type==="pipe"){const ld=dynRes?.links?.[selected.data.id];if(ld){data=ld.flow||[];yLabel="m³/s";title="流量";}}
      if(!data.length)return;
      const ch = core.init(chartRef.current);
      ch.setOption({
        backgroundColor:"transparent",grid:{top:28,right:12,bottom:24,left:48},
        tooltip:{trigger:"axis"},
        xAxis:{type:"category",data:ts,axisLabel:{color:"#888",fontSize:9,interval:Math.max(0,Math.floor(ts.length/6)-1)}},
        yAxis:{type:"value",name:yLabel,nameTextStyle:{color:"#888",fontSize:9},axisLabel:{color:"#888",fontSize:9}},
        series:[{name:title,type:"line",data,smooth:false,symbol:"none",lineStyle:{color:"#4fc3f7",width:1.5},
          markLine:dynStep<data.length?{silent:true,symbol:"none",lineStyle:{color:"#ff0",width:1,type:"dashed"},data:mark,label:{show:true,formatter:curTime,color:"#ff0",fontSize:9}}:undefined}],
        legend:{show:false}
      });
      setReady(true);
      return ()=>{ch.dispose();};
    });
    return ()=>{cancelled=true;};
  },[selected.data?.id,selected.type,dynStep,dynRes?.simulationId]);

  return (
    <div className="absolute left-2 right-2 bg-black/95 backdrop-blur rounded-lg border border-gray-700 z-10" style={{bottom:140}}>
      <div className="flex justify-between px-3 py-1.5 text-[10px] text-gray-400 border-b border-gray-800">
        <span>📈 {selected.data?.id} 时间序列</span>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-200">✕</button>
      </div>
      <div ref={chartRef} style={{height:150}} />
    </div>
  );
}
