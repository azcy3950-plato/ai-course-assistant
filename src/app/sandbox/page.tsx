"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

// ═══════════════════════════════════════════════════════════
// INP PARSER
// ═══════════════════════════════════════════════════════════
const CX=529350, CY=305850;
function sec(t:string,s:string,e:string){const i=t.indexOf(s);if(i<0)return"";const j=t.indexOf(e,i+s.length);return t.substring(i+s.length,j>0?j:t.length)}
function toX(x:number){return x-CX} function toZ(y:number){return-(y-CY)}

type Node3D={id:string;x:number;z:number;invert:number;maxD:number;initD:number;ground:number;type:string};
type Pipe3D={id:string;from:string;to:string;diam:number;length:number;roughness:number;fromInv:number;toInv:number;shape:string;inOffset:number;outOffset:number;verts:[number,number][]};
type SC3D={id:string;pts:[number,number][];imperv:number;area:number;outlet:string;width:number;slope:number};

function parseInp(text:string){
  const coordSec=sec(text,"[COORDINATES]","[VERTICES]"),juncSec=sec(text,"[JUNCTIONS]","[OUTFALLS]"),outfSec=sec(text,"[OUTFALLS]","[CONDUITS]"),condSec=sec(text,"[CONDUITS]","[XSECTIONS]"),xsecSec=sec(text,"[XSECTIONS]","[TIMESERIES]"),subcSec=sec(text,"[SUBCATCHMENTS]","[SUBAREAS]"),vertSec=sec(text,"[VERTICES]","[Polygons]");
  const pi=text.indexOf("[Polygons]");const polySec=pi>=0?text.substring(pi+"[Polygons]".length):"";
  type RN={x:number;z:number;invert:number;maxD:number;initD:number;type:string};
  const rn=new Map<string,RN>();
  coordSec.split("\n").forEach(l=>{const m=l.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)/);if(m)rn.set(m[1],{x:toX(+m[2]),z:toZ(+m[3]),invert:0,maxD:3.5,initD:0,type:"junction"})});
  juncSec.split("\n").forEach(l=>{const m=l.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);if(m&&rn.has(m[1])){const n=rn.get(m[1])!;n.invert=+m[2];n.maxD=+m[3];n.initD=+m[4]||0}});
  const ofs=new Set<string>();outfSec.split("\n").forEach(l=>{const m=l.trim().match(/^(\S+)\s+([\d.]+)/);if(m){ofs.add(m[1]);if(rn.has(m[1])){rn.get(m[1])!.invert=+m[2];rn.get(m[1])!.type="outfall"}}});
  const dm=new Map<string,number>(),sm2=new Map<string,string>();xsecSec.split("\n").forEach(l=>{const m=l.trim().match(/^(\S+)\s+(\S+)\s+([\d.]+)/);if(m){dm.set(m[1],+m[3]);sm2.set(m[1],m[2])}});
  const pipes:Pipe3D[]=[];condSec.split("\n").forEach(l=>{const m=l.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);if(m){const fn=rn.get(m[2]),tn=rn.get(m[3]);pipes.push({id:m[1],from:m[2],to:m[3],diam:dm.get(m[1])||.3,length:+m[4],roughness:+m[5]||.013,fromInv:fn?.invert||0,toInv:tn?.invert||0,shape:sm2.get(m[1])||"CIRCULAR",inOffset:+m[6]||0,outOffset:+m[7]||0,verts:[]})}});
  const vm=new Map<string,[number,number][]>();vertSec.split("\n").forEach(l=>{const m=l.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)/);if(m){if(!vm.has(m[1]))vm.set(m[1],[]);vm.get(m[1])!.push([toX(+m[2]),toZ(+m[3])])}});pipes.forEach(p=>{p.verts=vm.get(p.id)||[]});
  const im=new Map<string,number>(),sa=new Map<string,number>(),so=new Map<string,string>(),sw2=new Map<string,number>(),ss=new Map<string,number>();subcSec.split("\n").forEach(l=>{const m=l.trim().match(/^(\S+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);if(m){so.set(m[1],m[2]);sa.set(m[1],+m[3]);im.set(m[1],+m[4]);sw2.set(m[1],+m[5]||0);ss.set(m[1],+m[6]||0)}});
  const scs:SC3D[]=[];let ci="",cp:[number,number][]=[];polySec.split("\n").forEach(l=>{const m=l.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)/);if(m){if(m[1]!==ci){if(cp.length>=3)scs.push({id:ci,pts:cp,imperv:im.get(ci)||50,area:sa.get(ci)||0,outlet:so.get(ci)||"",width:sw2.get(ci)||0,slope:ss.get(ci)||0});ci=m[1];cp=[]}cp.push([toX(+m[2]),toZ(+m[3])])}});
  if(cp.length>=3)scs.push({id:ci,pts:cp,imperv:im.get(ci)||50,area:sa.get(ci)||0,outlet:so.get(ci)||"",width:sw2.get(ci)||0,slope:ss.get(ci)||0});
  const nl:Node3D[]=[];rn.forEach((n,id)=>{nl.push({id,x:n.x,z:n.z,invert:n.invert,maxD:n.maxD,initD:n.initD,ground:n.invert+n.maxD,type:n.type})});
  return{nodes:nl,pipes,scs,outfallIds:ofs};
}

// ═══════════════════════════════════════════════════════════
// CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════════════
function chL(k:string):string{const m:Record<string,string>={id:"编号",type:"类型",invert:"井底高程",ground:"地表高程",maxDepth:"最大水深",initDepth:"初始水深",from:"起点",to:"终点",diam:"管径",length:"长度",roughness:"糙率",shape:"断面形式",inOffset:"起点偏移",outOffset:"终点偏移",area:"面积",imperv:"不透水率",outlet:"出口节点",width:"宽度",slope:"坡度",vertices:"边界顶点数",vertCount:"中间顶点数",depth:"当前水深",totalInflow:"总入流",pondedVolume:"地表积水体积",floodingLosses:"节点洪泛损失",flow:"当前流量",velocity:"当前流速",capacity:"容量利用率",depthFraction:"充满度",volume:"当前体积"};return m[k]||k}
function fV(k:string,v:any):string{if(v==null||v==="")return"未配置";if(typeof v!=="number")return String(v);if(k==="area")return(v/10000).toFixed(3)+" ha";if(k==="imperv")return v.toFixed(0)+" %";if(k==="slope")return(v*100).toFixed(2)+" %";if(["invert","ground","maxDepth","initDepth","diam","length","inOffset","outOffset","width"].includes(k))return v.toFixed(2)+" m";return v.toFixed(3)}
function fT(h:number){const m=Math.round(h*60);return`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`}
function scC(imp:number){return imp>80?"#b08070":imp>40?"#a09580":"#809870"}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export default function SandboxPage(){
  const cr=useRef<HTMLDivElement>(null);
  const scRef=useRef<THREE.Scene|null>(null);
  const camRef=useRef<THREE.PerspectiveCamera|null>(null);
  const rndRef=useRef<THREE.WebGLRenderer|null>(null);
  const grpRef=useRef<Record<string,THREE.Group>>({});
  const dataRef=useRef<any>(null);
  const nMap=useRef<Map<string,{g:THREE.Group;iy:number;gy:number}>>(new Map());
  const pMap=useRef<Map<string,{m:THREE.Mesh;c:THREE.CatmullRomCurve3}>>(new Map());
  const wMap=useRef<Map<string,THREE.Mesh>>(new Map());
  const aMap=useRef<Map<string,THREE.Mesh[]>>(new Map());
  const selRef=useRef<THREE.Object3D|null>(null);
  const spanRef=useRef(300);const surfRef=useRef(0);
  const arrowGeom=useRef<THREE.ConeGeometry|null>(null);
  const camState=useRef({tx:0,tz:0,ty:0});

  const[loaded,setLoaded]=useState(false);const[error,setError]=useState("");
  const[mode,setMode]=useState<"static"|"dynamic">("static");
  const[selected,setSelected]=useState<any>(null);const[hovered,setHovered]=useState<any>(null);
  const[layers,setLayers]=useState<Record<string,boolean>>({ground:true,sc:true,pipes:true,nodes:true});
  const[stats,setStats]=useState({nodes:0,pipes:0,scs:0});
  const[ve,setVe]=useState(5);const[searchQ,setSearchQ]=useState("");const[searchRes,setSearchRes]=useState<any[]>([]);
  const[leftOpen,setLeftOpen]=useState(true);const[rightOpen,setRightOpen]=useState(true);
  const[isolated,setIsolated]=useState<string|null>(null);

  const[dynI,setDynI]=useState(100);const[dynRes,setDynRes]=useState<any>(null);
  const[dynStep,setDynStep]=useState(0);const[dynPlay,setDynPlay]=useState(false);
  const[dynSpd,setDynSpd]=useState(1);const[dynPhase,setDynPhase]=useState<"config"|"loading"|"ready"|"running"|"paused"|"done">("config");
  const[simId,setSimId]=useState("");const[showCurves,setShowCurves]=useState(false);

  const tsc=dynRes?.timeStepCount||0;const timestamps:number[]=dynRes?.timestamps||[];
  const ctT=timestamps[dynStep]!==undefined?fT(timestamps[dynStep]):"--:--";

  // ═══════════════════════════════════════════════════════════
  // SCENE BUILD
  // ═══════════════════════════════════════════════════════════
  function buildScene(data:any,_ve:number){
    const scene=scRef.current!;Object.values(grpRef.current).forEach(g=>{while(g.children.length>0)g.remove(g.children[0])});
    nMap.current.clear();pMap.current.clear();wMap.current.clear();aMap.current.clear();
    arrowGeom.current=new THREE.ConeGeometry(.12,.25,5,3);

    let mnX=Infinity,mxX=-Infinity,mnZ=Infinity,mxZ=-Infinity,minE=Infinity,maxE=-Infinity;
    data.nodes.forEach((n:Node3D)=>{if(n.x<mnX)mnX=n.x;if(n.x>mxX)mxX=n.x;if(n.z<mnZ)mnZ=n.z;if(n.z>mxZ)mxZ=n.z;if(n.invert<minE)minE=n.invert;if(n.ground>maxE)maxE=n.ground});
    const sp=Math.max(mxX-mnX,mxZ-mnZ,50);spanRef.current=sp;
    const eY=(e:number)=>(e-minE)*_ve;
    const avgS=data.nodes.reduce((s:number,n:Node3D)=>s+n.ground,0)/data.nodes.length;
    const surfY=eY(avgS);surfRef.current=surfY;

    // Sizing
    const NR=Math.max(.35,sp*.0012),OR=NR*1.35;
    const PMinR=Math.max(.3,sp*.0022),PMaxR=sp*.005;
    function pR(d:number){return Math.max(PMinR,Math.min(PMaxR,d*.55))}

    // ── Ground plane (thin, semi-transparent) ──
    const gs=sp*1.1;const gp=new THREE.PlaneGeometry(gs,gs);gp.rotateX(-Math.PI/2);
    const gm=new THREE.Mesh(gp,new THREE.MeshStandardMaterial({color:"#5a5a55",roughness:.9,transparent:true,opacity:.22,depthWrite:false}));
    gm.position.y=surfY;gm.renderOrder=0;gm.name="ground";grpRef.current.ground.add(gm);
    const gs2=Math.ceil(sp/12/10)*10||20;const gh=new THREE.GridHelper(Math.round(gs/gs2)*gs2,Math.round(gs/gs2),"#666","#444");
    gh.position.y=surfY+.02;grpRef.current.ground.add(gh);

    // ── Subcatchments ──
    data.scs.forEach((sc:SC3D)=>{if(sc.pts.length<3)return;const sh=new THREE.Shape();sc.pts.forEach(([x,z],i)=>i===0?sh.moveTo(x,z):sh.lineTo(x,z));const c=scC(sc.imperv);const g=new THREE.ExtrudeGeometry(sh,{steps:1,depth:.01,bevelEnabled:false});const f=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:c,roughness:.75,transparent:true,opacity:.08,side:THREE.DoubleSide,depthWrite:false}));f.rotation.x=-Math.PI/2;f.position.y=surfY+.04;f.renderOrder=1;f.userData={type:"subcatchment",data:{id:sc.id,area:sc.area,imperv:sc.imperv,outlet:sc.outlet,width:sc.width,slope:sc.slope,vertices:sc.pts.length}};grpRef.current.sc.add(f)});

    // ── Nodes ──
    data.nodes.forEach((n:Node3D)=>{
      const g=new THREE.Group();const iy=eY(n.invert),gy=eY(n.ground),shH=Math.max(.12,gy-iy);if(shH<.05)return;
      const isO=n.type==="outfall";const r=isO?OR:NR;
      // Shaft
      const sg=new THREE.CylinderGeometry(r*.55,r*.55,shH,10);const sm=new THREE.Mesh(sg,new THREE.MeshStandardMaterial({color:"#7a8894",roughness:.4,metalness:.05}));
      sm.position.y=iy+shH/2;sm.castShadow=true;sm.receiveShadow=true;g.add(sm);
      // Ring
      const tg=new THREE.TorusGeometry(r,r*.18,8,12);const tm=new THREE.Mesh(tg,new THREE.MeshStandardMaterial({color:isO?"#c08060":"#8898a4",roughness:.15,metalness:.05}));
      tm.position.y=gy;tm.rotation.x=Math.PI/2;g.add(tm);
      // Bottom
      const bg=new THREE.CylinderGeometry(r*.45,r*.45,.03,10);const bm=new THREE.Mesh(bg,new THREE.MeshStandardMaterial({color:"#3a4048",roughness:.6}));
      bm.position.y=iy;g.add(bm);
      g.position.set(n.x,0,n.z);g.userData={type:"node",data:{id:n.id,type:n.type,invert:n.invert,ground:n.ground,maxDepth:n.maxD,initDepth:n.initD}};
      grpRef.current.nodes.add(g);nMap.current.set(n.id,{g,iy,gy});
    });

    // ── Vertical drop lines (ground → pipe) ──
    const dropGrp=new THREE.Group();dropGrp.name="drops";
    data.pipes.forEach((p:Pipe3D)=>{
      const fn=data.nodes.find((nn:Node3D)=>nn.id===p.from),tn=data.nodes.find((nn:Node3D)=>nn.id===p.to);
      if(!fn||!tn)return;
      const fy=eY(fn.invert+.05),ty=eY(tn.invert+.05);
      // Drop line at from node
      const dp1=[new THREE.Vector3(fn.x,surfY,fn.z),new THREE.Vector3(fn.x,fy,fn.z)];
      const dg1=new THREE.BufferGeometry().setFromPoints(dp1);dropGrp.add(new THREE.Line(dg1,new THREE.LineBasicMaterial({color:"#555",transparent:true,opacity:.25})));
      // Drop line at to node
      const dp2=[new THREE.Vector3(tn.x,surfY,tn.z),new THREE.Vector3(tn.x,ty,tn.z)];
      const dg2=new THREE.BufferGeometry().setFromPoints(dp2);dropGrp.add(new THREE.Line(dg2,new THREE.LineBasicMaterial({color:"#555",transparent:true,opacity:.25})));
    });
    grpRef.current.nodes.add(dropGrp);

    // ── Pipes ──
    data.pipes.forEach((p:Pipe3D)=>{
      const fn=data.nodes.find((nn:Node3D)=>nn.id===p.from),tn=data.nodes.find((nn:Node3D)=>nn.id===p.to);
      if(!fn||!tn)return;
      const fy=eY(fn.invert+.05),ty=eY(tn.invert+.05);
      const vr=pR(p.diam);
      const path:THREE.Vector3[]=[new THREE.Vector3(fn.x,fy,fn.z)];
      p.verts.forEach(([vx,vz])=>path.push(new THREE.Vector3(vx,fy,vz)));path.push(new THREE.Vector3(tn.x,ty,tn.z));
      if(path.length<2)return;
      const curve=new THREE.CatmullRomCurve3(path);
      const tg=new THREE.TubeGeometry(curve,Math.max(10,path.length*4),vr,10,false);
      const tm=new THREE.Mesh(tg,new THREE.MeshStandardMaterial({color:"#607888",roughness:.35,metalness:.1,emissive:"#0a1016",emissiveIntensity:.04}));
      tm.castShadow=true;tm.receiveShadow=true;tm.userData={type:"pipe",data:{id:p.id,from:p.from,to:p.to,diam:p.diam,length:p.length,roughness:p.roughness,shape:p.shape,inOffset:p.inOffset,outOffset:p.outOffset,vertCount:p.verts.length}};
      // Hit target
      const ht=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(6,path.length*2),vr*3,6,false),new THREE.MeshBasicMaterial({visible:false,depthTest:false}));ht.name="hit";tm.add(ht);
      grpRef.current.pipes.add(tm);pMap.current.set(p.id,{m:tm,c:curve});
      // Pre-allocate arrows
      const arrows:THREE.Mesh[]=[];const am=new THREE.MeshStandardMaterial({color:"#44aadd",roughness:.3,emissive:"#001122",emissiveIntensity:.15});
      for(let i=0;i<4;i++){const a=new THREE.Mesh(arrowGeom.current!,am);a.visible=false;grpRef.current.pipes.add(a);arrows.push(a)}
      aMap.current.set(p.id,arrows);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // INIT EFFECT
  // ═══════════════════════════════════════════════════════════
  useEffect(()=>{(async()=>{
    try{
      const r=await fetch("/zijing_inp.inp");if(!r.ok)throw new Error("INP加载失败");
      const data=parseInp(await r.text());dataRef.current=data;setStats({nodes:data.nodes.length,pipes:data.pipes.length,scs:data.scs.length});
      if(!cr.current)return;
      const w=cr.current.clientWidth,h=cr.current.clientHeight;

      const scene=new THREE.Scene();scene.background=new THREE.Color("#1a1d23");scene.fog=new THREE.Fog("#1a1d23",200,1000);scRef.current=scene;
      const camera=new THREE.PerspectiveCamera(42,w/h,.3,2500);camRef.current=camera;
      const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(w,h);renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
      renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
      cr.current.appendChild(renderer.domElement);rndRef.current=renderer;

      scene.add(new THREE.AmbientLight("#556677",.55));
      const sun=new THREE.DirectionalLight("#fff8e8",2.2);sun.position.set(200,350,80);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.near=5;sun.shadow.camera.far=1200;sun.shadow.camera.left=-200;sun.shadow.camera.right=200;sun.shadow.camera.top=200;sun.shadow.camera.bottom=-200;sun.shadow.bias=-.0005;scene.add(sun);
      scene.add(new THREE.HemisphereLight("#8899cc","#334455",.45));

      grpRef.current={ground:new THREE.Group(),sc:new THREE.Group(),pipes:new THREE.Group(),nodes:new THREE.Group()};
      Object.values(grpRef.current).forEach(g=>scene.add(g));
      buildScene(data,5);

      // Default camera
      let cx=0,cz=0;data.nodes.forEach((n:Node3D)=>{cx+=n.x;cz+=n.z});cx/=data.nodes.length;cz/=data.nodes.length;
      const cy=surfRef.current*.5;const dist=spanRef.current*1.2;
      camera.position.set(cx+dist*.55,cy+dist*.5,cz+dist*.75);camera.lookAt(cx,cy,cz);
      camState.current={tx:cx,tz:cz,ty:cy};

      // Interaction
      const raycaster=new THREE.Raycaster();let dragging=false,last={x:0,y:0};
      renderer.domElement.addEventListener("pointerdown",e=>{
        if(e.button>1)return;dragging=true;last={x:e.clientX,y:e.clientY};
        const rect=renderer.domElement.getBoundingClientRect();const mouse=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
        raycaster.setFromCamera(mouse,camera);const hits=raycaster.intersectObjects(scene.children,true);
        if(hits.length>0){let obj:any=hits[0].object;while(obj){if(obj.userData?.type){if(selRef.current!==obj){clrSel();selRef.current=obj;hl(obj);setSelected({type:obj.userData.type,data:obj.userData.data})}return}obj=obj.parent}}
        clrSel();setSelected(null);
      });
      renderer.domElement.addEventListener("pointermove",e=>{
        if(dragging){camState.current.tx-=(e.clientX-last.x)*.3;camState.current.tz+=(e.clientY-last.y)*.3;last={x:e.clientX,y:e.clientY};camera.position.x=camState.current.tx+camState.current.tz*.3;camera.lookAt(camState.current.tx,camState.current.ty,camState.current.tz);return}
        const rect=renderer.domElement.getBoundingClientRect();const mouse=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
        raycaster.setFromCamera(mouse,camera);const hits=raycaster.intersectObjects(scene.children,true);
        let found:any=null;if(hits.length>0){let obj:any=hits[0].object;while(obj){if(obj.userData?.type){found=obj;break}obj=obj.parent}}
        setHovered(found?{type:found.userData.type,data:found.userData.data}:null);if(cr.current)cr.current.style.cursor=found?"pointer":"";
      });
      window.addEventListener("pointerup",()=>{dragging=false});
      renderer.domElement.addEventListener("wheel",e=>{e.preventDefault();const d2=Math.max(spanRef.current*.2,Math.min(spanRef.current*4,camera.position.length()+e.deltaY*.5));const dir=camera.position.clone().normalize();camera.position.copy(dir.multiplyScalar(d2));camera.lookAt(camState.current.tx,camState.current.ty,camState.current.tz)});
      document.addEventListener("keydown",e=>{if(e.key==="Escape"){clrSel();setSelected(null)}});

      const animate=()=>{requestAnimationFrame(animate);renderer.render(scene,camera)};animate();
      const onResize=()=>{const w2=cr.current!.clientWidth,h2=cr.current!.clientHeight;camera.aspect=w2/h2;camera.updateProjectionMatrix();renderer.setSize(w2,h2)};
      window.addEventListener("resize",onResize);setLoaded(true);
      return()=>{window.removeEventListener("resize",onResize);renderer.dispose()};
    }catch(e:any){setError(e.message)}
  })()},[]);

  function hl(o:THREE.Object3D){o.traverse(c=>{if(c instanceof THREE.Mesh&&c.material&&!(c.material as any)._isW){const m=c.material as any;m.emissive=new THREE.Color("#ffdd88");m.emissiveIntensity=.5}})}
  function clrSel(){if(selRef.current){selRef.current.traverse(c=>{if(c instanceof THREE.Mesh&&c.material&&!(c.material as any)._isW){const m=c.material as any;m.emissive=new THREE.Color("#000");m.emissiveIntensity=0}});selRef.current=null}}

  // ═══════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════
  const focusObj=(obj:any)=>{const d=dataRef.current;if(!d)return;let tx=0,tz=0,ty=0;if(obj.type==="node"){const n=d.nodes.find((nn:Node3D)=>nn.id===obj.data.id);if(n){tx=n.x;tz=n.z;ty=surfRef.current*.4}}else if(obj.type==="pipe"){const fn=d.nodes.find((nn:Node3D)=>nn.id===obj.data.from),tn=d.nodes.find((nn:Node3D)=>nn.id===obj.data.to);if(fn&&tn){tx=(fn.x+tn.x)/2;tz=(fn.z+tn.z)/2;ty=surfRef.current*.3}}camState.current={tx,tz,ty};const cam=camRef.current;if(cam){cam.position.set(tx+spanRef.current*.2,ty+spanRef.current*.4,tz+spanRef.current*.35);cam.lookAt(tx,ty,tz)}};
  const doSearch=(q:string)=>{setSearchQ(q);if(!q.trim()||!dataRef.current){setSearchRes([]);return}const d=dataRef.current,ql=q.toLowerCase(),r:any[]=[];d.nodes.forEach((n:Node3D)=>{if(n.id.toLowerCase().includes(ql))r.push({type:"node",data:{id:n.id,type:n.type,invert:n.invert,ground:n.ground}})});d.pipes.forEach((p:Pipe3D)=>{if(p.id.toLowerCase().includes(ql)||p.from.toLowerCase().includes(ql)||p.to.toLowerCase().includes(ql))r.push({type:"pipe",data:{id:p.id,from:p.from,to:p.to,diam:p.diam}})});setSearchRes(r.slice(0,20))};
  const locateRes=(r:any)=>{setSelected(r);focusObj(r)};
  const toggleLayer=(id:string)=>{setLayers(p=>{const n=!p[id];const g=grpRef.current[id];if(g)g.visible=n;return{...p,[id]:n}})};
  const isoObj=(obj:any)=>{if(!obj||!grpRef.current.nodes)return;setIsolated(obj.data.id);grpRef.current.nodes.children.forEach((g:any)=>{g.visible=g.userData?.data?.id===obj.data.id});grpRef.current.pipes.children.forEach((m:any)=>{const d2=m.userData?.data;m.visible=d2?.id===obj.data.id||d2?.from===obj.data.id||d2?.to===obj.data.id})};
  const resetIso=()=>{setIsolated(null);if(grpRef.current.nodes)grpRef.current.nodes.children.forEach((g:any)=>{g.visible=true});if(grpRef.current.pipes)grpRef.current.pipes.children.forEach((m:any)=>{m.visible=true})};

  // ═══════════════════════════════════════════════════════════
  // DYNAMIC
  // ═══════════════════════════════════════════════════════════
  const loadSim=useCallback(async()=>{setDynPhase("loading");setDynStep(0);try{const ctrl=new AbortController();const tid=setTimeout(()=>ctrl.abort(),90000);const token=(typeof window!=="undefined"?localStorage.getItem("aicourse-token")||"":"");const res=await fetch("/api/swmm",{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:JSON.stringify({intensity:dynI}),signal:ctrl.signal});clearTimeout(tid);const d=await res.json();if(!d.ok)throw new Error(d.error||"API error");setDynRes(d);setDynPhase("ready");setSimId(d.simulationId||"")}catch(e:any){setDynPhase("config");if(e.name!=="AbortError")alert("仿真失败:"+e.message)}},[dynI]);
  useEffect(()=>{if(!dynPlay||dynPhase!=="running"||tsc===0)return;const t=setInterval(()=>{setDynStep(p=>{const n=p+1;if(n>=tsc-1){setDynPlay(false);setDynPhase("done");return tsc-1}return n})},140/dynSpd);return()=>clearInterval(t)},[dynPlay,dynSpd,dynPhase,tsc]);

  // Water columns
  useEffect(()=>{if(!dynRes?.nodes||!scRef.current)return;
    nMap.current.forEach(({g,iy,gy},nid)=>{const nd=dynRes.nodes[nid];const depth=nd?.depth?.[dynStep]??0;const ponding=nd?.pondedVolume?.[dynStep]??0;const ni=dataRef.current?.nodes.find((n:Node3D)=>n.id===nid);const isOvf=ni&&depth>(ni.maxD||99);
      let wm=wMap.current.get(nid);if(depth<.003){if(wm)wm.visible=false;return}
      if(!wm){const wg=new THREE.CylinderGeometry(.14,.14,1,8);const wmt=new THREE.MeshStandardMaterial({color:"#4499cc",roughness:.1,metalness:.05,emissive:"#001122",emissiveIntensity:.2,transparent:true,opacity:.7,depthWrite:true});(wmt as any)._isW=true;wm=new THREE.Mesh(wg,wmt);wm.position.set(0,iy,0);(wm as any).userData={water:true};g.add(wm);wMap.current.set(nid,wm)}
      wm.visible=true;const wh=Math.max(.03,depth*ve);wm.scale.y=wh;wm.position.y=iy+wh/2;const m=wm.material as THREE.MeshStandardMaterial;
      if(ponding>.01||isOvf){m.color.set("#e04040");m.emissive.set("#300000");m.emissiveIntensity=.4}else{const r2=Math.min(1,depth/(dynRes.summary?.maxDepth?.value||1));m.color.set(new THREE.Color().setHSL(.57-r2*.12,.7,.35+r2*.2));m.emissive.set("#001122");m.emissiveIntensity=.15+r2*.2}
      // Ponding ring
      const rings=g.children.filter(c=>(c as any).userData?.ofRing);rings.forEach(c=>g.remove(c));
      if(ponding>.01){const rg=new THREE.TorusGeometry(.25,.04,6,8);const rm=new THREE.Mesh(rg,new THREE.MeshStandardMaterial({color:"#e04040",emissive:"#300000",emissiveIntensity:.6,roughness:.1}));rm.position.y=gy;rm.rotation.x=Math.PI/2;(rm as any).userData={ofRing:true};g.add(rm)}
    });
  },[dynStep,dynRes,ve]);

  // Flow arrows
  useEffect(()=>{const t0=performance.now();const upd=()=>{
    aMap.current.forEach((arrows,pid)=>{const ld=dynRes?.links?.[pid];const flow=ld?.flow?.[dynStep]??0;const vel=ld?.velocity?.[dynStep]??0;const af=Math.abs(flow);if(af<.0005){arrows.forEach(a=>a.visible=false);return}
      const curve=pMap.current.get(pid)?.c;if(!curve){arrows.forEach(a=>a.visible=false);return}
      const dir=flow>=0?1:-1;const speed=Math.max(.1,Math.min(2,af*2));const off=((performance.now()-t0)*.001*speed*dir%1+1)%1;
      arrows.forEach((a,i)=>{a.visible=true;const t=((i/4+off)%1+1)%1;const pt=curve.getPointAt(t);const tg=curve.getTangentAt(t).normalize();if(dir<0)tg.negate();a.position.copy(pt);a.position.y+=.2;const quat=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),tg);a.setRotationFromQuaternion(quat)});
    });
    if(mode==="dynamic"&&(dynPhase==="running"||dynPhase==="paused"))requestAnimationFrame(upd);
  };upd();return()=>{aMap.current.forEach(arrows=>arrows.forEach(a=>{a.visible=false}))}},[mode,dynPhase,dynStep,dynRes]);

  useEffect(()=>{if(mode!=="dynamic"){wMap.current.forEach(wm=>{if(wm.parent)wm.parent.remove(wm);wm.geometry?.dispose();(wm.material as THREE.Material)?.dispose()});wMap.current.clear();aMap.current.forEach(arrows=>arrows.forEach(a=>a.visible=false))}},[mode]);

  // ═══════════════════════════════════════════════════════════
  // CURVES (ECharts, no errors via proper lifecycle)
  // ═══════════════════════════════════════════════════════════
  const cDivs=useRef<(HTMLDivElement|null)[]>([null,null,null,null]);
  const cInst=useRef<any[]>([]);
  useEffect(()=>{if(!showCurves||!selected||!dynRes?.ok||tsc===0)return;let ok=true;
    import("echarts/core").then(async core=>{if(!ok)return;const[charts,comps,rend]=await Promise.all([import("echarts/charts"),import("echarts/components"),import("echarts/renderers")]);core.use([charts.LineChart,comps.GridComponent,comps.TooltipComponent,comps.LegendComponent,rend.CanvasRenderer]);
      cInst.current.forEach(ch=>ch?.dispose());cInst.current=[];
      const ts=timestamps.map((t:number)=>t.toFixed(1)+"h");const mk=dynStep<ts.length?[{xAxis:ts[dynStep]}]:[];
      const opt=(data:number[],yL:string,title:string,color:string)=>({backgroundColor:"transparent",grid:{top:20,right:6,bottom:16,left:38},xAxis:{type:"category",data:ts,axisLabel:{color:"#888",fontSize:7,interval:Math.max(0,Math.floor(ts.length/6)-1)}},yAxis:{type:"value",name:yL,nameTextStyle:{color:"#888",fontSize:7},axisLabel:{color:"#888",fontSize:7}},series:[{name:title,type:"line",data,smooth:false,symbol:"none",lineStyle:{color,width:1},markLine:dynStep<data.length?{silent:true,symbol:"none",lineStyle:{color:"#ff0",width:1,type:"dashed"},data:mk,label:{show:true,formatter:ctT,color:"#ff0",fontSize:7}}:undefined}]});
      let cfgs:{data:number[];yL:string;title:string;color:string}[]=[];
      if(selected.type==="node"){const nd=dynRes.nodes[selected.data.id];if(nd)cfgs=[{data:nd.depth||[],yL:"m",title:"水深",color:"#4fc3f7"},{data:nd.totalInflow||[],yL:"m³/s",title:"总入流",color:"#81c784"},{data:nd.pondedVolume||[],yL:"m³",title:"地表积水体积",color:"#ff8a65"},{data:nd.floodingLosses||[],yL:"",title:"洪泛损失",color:"#ef5350"}]}
      else if(selected.type==="pipe"){const ld=dynRes.links[selected.data.id];if(ld)cfgs=[{data:ld.flow||[],yL:"m³/s",title:"流量",color:"#4fc3f7"},{data:ld.depth||[],yL:"m",title:"水深",color:"#81c784"},{data:ld.velocity||[],yL:"m/s",title:"流速",color:"#ff8a65"},{data:ld.capacity||[],yL:"",title:"容量利用率",color:"#ba68c8"}]}
      cfgs.forEach((cfg,i)=>{const el=cDivs.current[i];if(!el||!ok)return;const ch=core.init(el);ch.setOption(opt(cfg.data,cfg.yL,cfg.title,cfg.color));ch.on("click",(params:any)=>{if(params.dataIndex!==undefined)setDynStep(params.dataIndex)});cInst.current.push(ch)});
    });return()=>{ok=false}},[showCurves,selected?.data?.id,selected?.type,dynStep,dynRes?.simulationId]);
  useEffect(()=>{if(!showCurves){cInst.current.forEach(ch=>ch?.dispose());cInst.current=[]}},[showCurves]);

  const curND=(mode==="dynamic"&&selected?.type==="node"&&dynRes?.nodes)?dynRes.nodes[selected.data.id]:null;
  const curLD=(mode==="dynamic"&&selected?.type==="pipe"&&dynRes?.links)?dynRes.links[selected.data.id]:null;

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return(
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-black relative overflow-hidden">
      {/* TOP */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-black/94 border-b border-gray-800 flex items-center px-3 gap-2" style={{height:46}}>
        <span className="font-bold text-gray-200 text-sm">🌊 紫荆雅园</span>
        <div className="flex bg-gray-800 rounded-lg p-0.5">
          <button onClick={()=>setMode("static")} className={"px-4 py-1 rounded-md font-bold text-sm "+(mode==="static"?"bg-blue-600 text-white":"text-gray-400 hover:text-white")}>📐 静态</button>
          <button onClick={()=>setMode("dynamic")} className={"px-4 py-1 rounded-md font-bold text-sm "+(mode==="dynamic"?"bg-cyan-600 text-white":"text-gray-400 hover:text-white")}>▶ 动态</button>
        </div>
        <div className="h-4 w-px bg-gray-600"/>
        <button onClick={()=>{if(cr.current){if(document.fullscreenElement)document.exitFullscreen();else cr.current.requestFullscreen()}}} className="px-2 py-1 text-[10px] bg-gray-800 hover:bg-gray-700 rounded text-gray-300">⛶</button>
        <span className="text-[10px] text-gray-500 ml-2">VE:</span>
        {[1,3,5,8].map(v=>(<button key={v} onClick={()=>{setVe(v);buildScene(dataRef.current,v)}} className={"px-1.5 py-0.5 rounded text-[10px] "+(ve===v?"bg-blue-700":"bg-gray-800 text-gray-400")}>{v}×</button>))}
        <span className="text-[9px] text-gray-600 ml-auto">{stats.nodes}节点 · {stats.pipes}管 · {stats.scs}汇水区</span>
      </div>

      {/* LEFT */}
      <div className={"absolute left-0 z-20 bg-black/93 border-r border-gray-800 transition-all flex flex-col "+(leftOpen?"w-[190px]":"w-[24px]")} style={{top:46,bottom:0}}>
        <button onClick={()=>setLeftOpen(!leftOpen)} className="absolute -right-5 top-2 w-5 h-10 bg-gray-800 rounded-r text-[10px] text-gray-400">{leftOpen?"◀":"▶"}</button>
        {leftOpen&&<div className="p-2 overflow-y-auto flex-1">
          <div className="text-[10px] font-bold text-gray-400 mb-2">图层</div>
          {[{id:"ground",l:"地表参考面"},{id:"sc",l:"汇水区"},{id:"pipes",l:"管道"},{id:"nodes",l:"节点"}].map(({id,l})=>(<label key={id} className="flex items-center gap-2 text-[10px] text-gray-400 hover:text-gray-200 cursor-pointer"><input type="checkbox" checked={layers[id]} onChange={()=>toggleLayer(id)} className="accent-cyan-500"/>{l}</label>))}
          <div className="mt-2"><input type="text" placeholder="搜索…" value={searchQ} onChange={e=>doSearch(e.target.value)} className="w-full bg-gray-800 rounded px-2 py-1 text-[10px] text-gray-200 border border-gray-700 focus:border-cyan-600 outline-none"/></div>
          {searchRes.length>0&&<div className="space-y-0.5 max-h-[180px] overflow-y-auto mt-1">{searchRes.map((r,i)=>(<div key={i} onClick={()=>locateRes(r)} className="text-[10px] text-gray-400 hover:text-white hover:bg-gray-800 rounded px-1.5 py-0.5 cursor-pointer truncate">{r.type==="node"?"🔹":"▬"} {r.data.id}</div>))}</div>}
          {isolated&&<button onClick={resetIso} className="w-full text-[10px] bg-red-900 hover:bg-red-800 rounded px-2 py-1 text-gray-300 mt-2">恢复</button>}
          {selected&&!isolated&&<button onClick={()=>isoObj(selected)} className="w-full text-[10px] bg-gray-800 hover:bg-gray-700 rounded px-2 py-1 text-gray-400 mt-1">隔离查看</button>}
          <div className="text-[8px] text-gray-600 mt-3">地面为节点高程工程参考面，非真实DEM。属性数值为真实数据。</div>
        </div>}
      </div>

      {/* SCENE */}
      <div ref={cr} className="flex-1"/>

      {/* RIGHT */}
      <div className={"absolute right-0 z-20 bg-black/93 border-l border-gray-800 transition-all flex flex-col overflow-y-auto "+(rightOpen?"w-[310px]":"w-[24px]")} style={{top:46,bottom:mode==="dynamic"&&dynRes?.ok?120:0}}>
        <button onClick={()=>setRightOpen(!rightOpen)} className="absolute -left-5 top-2 w-5 h-10 bg-gray-800 rounded-l text-[10px] text-gray-400">{rightOpen?"▶":"◀"}</button>
        {rightOpen&&<div className="p-2.5">
          {mode==="static"&&selected&&(<>
            <div className="text-xs font-bold text-gray-300 mb-2 flex justify-between"><span>{{node:"🔹节点",pipe:"▬管道",subcatchment:"▨汇水区"}[selected.type as string]||selected.type}</span><button onClick={()=>{clrSel();setSelected(null)}} className="text-gray-500">✕</button></div>
            <div className="space-y-0.5">{Object.entries(selected.data).map(([k,v]:[string,any])=>(<div key={k} className="flex justify-between text-[10px]"><span className="text-gray-500">{chL(k)}</span><span className="text-gray-200 text-right ml-2">{k==="type"?(v==="outfall"?"出水口":"检查井"):fV(k,v)}</span></div>))}</div>
            {selected.type==="node"&&<div className="mt-2 text-[9px] text-gray-500">井深:{fV("maxDepth",selected.data.maxDepth)} | 井底:{fV("invert",selected.data.invert)} | 地表:{fV("ground",selected.data.ground)}</div>}
          </>)}
          {mode==="static"&&!selected&&<div className="text-[10px] text-gray-600 text-center py-8">点击对象查看</div>}
          {mode==="dynamic"&&(<>
            <div className="text-xs font-bold text-gray-300 mb-2">{{config:"⚙️配置",loading:"⏳仿真…",ready:"📊就绪",running:"🔵运行",paused:"⏸暂停",done:"✅完成"}[dynPhase]}</div>
            {(dynPhase==="config"||dynPhase==="ready"||dynPhase==="done")&&(<div className="space-y-2">
              <div><div className="flex justify-between text-[10px]"><span className="text-gray-500">降雨倍率</span><span className="text-cyan-400 font-bold">{dynI}%</span></div><input type="range" min="10" max="300" value={dynI} onChange={e=>setDynI(+e.target.value)} className="w-full accent-cyan-500 mt-0.5 h-1.5"/></div>
              <button onClick={loadSim} className="w-full py-2 bg-cyan-800 rounded font-bold text-xs hover:bg-cyan-700">{dynRes?"🔄重新仿真":"📊开始推演"}</button>
              {dynPhase==="ready"&&<button onClick={()=>{setDynPhase("running");setDynPlay(true);setDynStep(0)}} className="w-full py-2 bg-green-800 rounded font-bold text-xs hover:bg-green-700">▶播放</button>}
              {dynPhase==="done"&&<button onClick={()=>{setDynStep(0);setDynPlay(true);setDynPhase("running")}} className="w-full py-2 bg-green-800 rounded font-bold text-xs hover:bg-green-700">🔄重新播放</button>}
            </div>)}
            {(dynPhase==="running"||dynPhase==="paused")&&(<div className="space-y-1"><div className="flex justify-between text-[10px]"><span className="text-gray-500">时间</span><span className="text-gray-200 font-mono">{ctT}</span></div><div className="flex justify-between text-[10px]"><span className="text-gray-500">步</span><span className="text-gray-200">{dynStep+1}/{tsc}</span></div></div>)}
            {dynPhase==="loading"&&<div className="text-center py-4"><div className="animate-spin text-lg mb-1">⏳</div><div className="text-[9px] text-gray-400">运行SWMM…</div></div>}
            {simId&&<div className="text-[8px] text-gray-600 mt-1 truncate">{simId.slice(0,16)}…</div>}
            {selected&&(dynPhase==="running"||dynPhase==="paused"||dynPhase==="done")&&(<div className="border-t border-gray-700 mt-2 pt-2 space-y-0.5">
              <div className="text-xs font-bold text-gray-300 mb-1">{{node:"🔹 "+selected.data.id,pipe:"▬ "+selected.data.id}[selected.type as string]}</div>
              {selected.type==="node"&&curND&&(<><DP l="水深" v={curND.depth?.[dynStep]??0} u="m"/><DP l="总入流" v={curND.totalInflow?.[dynStep]??0} u="m³/s"/><DP l="积水" v={curND.pondedVolume?.[dynStep]??0} u="m³" warn={(curND.pondedVolume?.[dynStep]??0)>.01}/><DP l="洪泛" v={curND.floodingLosses?.[dynStep]??0} warn={(curND.floodingLosses?.[dynStep]??0)>.01}/></>)}
              {selected.type==="pipe"&&curLD&&(<><DP l="流量" v={curLD.flow?.[dynStep]??0} u="m³/s"/><DP l="流速" v={curLD.velocity?.[dynStep]??0} u="m/s"/><DP l="充满度" v={(curLD.depthFraction?.[dynStep]??0)*100} u="%" pct/><DP l="流向" l2={(curLD.flow?.[dynStep]??0)>=0?selected.data.to:selected.data.from} dir/></>)}
              <button onClick={()=>setShowCurves(!showCurves)} className="w-full text-[9px] bg-gray-800 hover:bg-gray-700 rounded px-2 py-1 text-gray-400 mt-1">📈{showCurves?"收起":"展开"}曲线</button>
            </div>)}
          </>)}
        </div>}
      </div>

      {/* PLAYBACK */}
      {mode==="dynamic"&&dynRes?.ok&&(dynPhase==="running"||dynPhase==="paused"||dynPhase==="done")&&tsc>0&&(
        <div className="absolute bottom-0 left-0 right-0 bg-black/95 border-t border-gray-800 z-20 px-4 py-2" style={{height:120}}>
          <div className="flex items-center gap-1 justify-center mb-1">
            <PB i="⏮" o={()=>setDynStep(0)}/><PB i="◀" o={()=>setDynStep(s=>Math.max(0,s-1))}/>
            {dynPhase==="running"?<PB i="⏸" o={()=>{setDynPlay(false);setDynPhase("paused")}} c="bg-yellow-800 hover:bg-yellow-700"/>:<PB i="▶" o={()=>{if(dynStep>=tsc-1)setDynStep(0);setDynPlay(true);setDynPhase("running")}} c="bg-green-800 hover:bg-green-700"/>}
            <PB i="▶▶" o={()=>setDynStep(s=>Math.min(tsc-1,s+10))}/><PB i="⏹" o={()=>{setDynPlay(false);setDynPhase("done")}} c="bg-red-900 hover:bg-red-800"/>
            <span className="text-[10px] text-gray-400 font-mono w-12 text-center ml-2">{ctT}</span><span className="text-[9px] text-gray-500">{dynStep+1}/{tsc}</span>
            {[0.5,1,2,5].map(s=>(<button key={s} onClick={()=>setDynSpd(s)} className={"px-2 py-0.5 rounded text-[10px] "+(dynSpd===s?"bg-cyan-800 text-white":"bg-gray-800 text-gray-400")}>{s}×</button>))}
          </div>
          <input type="range" min={0} max={tsc-1} value={dynStep} onChange={e=>{setDynStep(+e.target.value);if(dynPlay){setDynPlay(false);setDynPhase("paused")}}} className="w-full h-2 appearance-none bg-gray-800 rounded-full cursor-pointer [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"/>
        </div>
      )}

      {/* CURVES */}
      {mode==="dynamic"&&showCurves&&selected&&dynRes?.ok&&tsc>0&&(
        <div className="absolute left-2 right-2 bg-black/96 rounded-lg border border-gray-700 z-10" style={{bottom:128,maxHeight:300}}>
          <div className="flex justify-between px-3 py-1 text-[10px] text-gray-400 border-b border-gray-800"><span>📈{selected.data?.id}</span><button onClick={()=>setShowCurves(false)} className="text-gray-500">✕</button></div>
          <div className="grid grid-cols-2 gap-0.5 p-1">{[0,1,2,3].map(i=><div key={i} ref={el=>{cDivs.current[i]=el}} style={{height:110}}/>)}</div>
        </div>
      )}

      {/* OVERLAYS */}
      {!loaded&&!error&&<div className="absolute inset-0 flex items-center justify-center bg-gray-950 z-30 pointer-events-none"><span className="animate-spin mr-2">⏳</span><span className="text-sm text-gray-300">加载SWMM模型…</span></div>}
      {error&&<div className="absolute inset-0 flex items-center justify-center bg-gray-950 z-30"><div className="text-center bg-red-900/60 rounded-xl p-6 max-w-md"><div className="text-2xl mb-2">⚠</div><div className="text-sm mb-1 text-gray-200">{error}</div><button onClick={()=>window.location.reload()} className="mt-3 px-4 py-1.5 bg-red-800 rounded text-xs text-white">刷新</button></div></div>}
      {hovered&&<div className="absolute z-30 pointer-events-none bg-black/88 rounded px-2 py-1 text-[10px] text-gray-200 border border-gray-700" style={{left:200,top:52}}>{{node:"🔹",pipe:"▬",subcatchment:"▨"}[hovered.type as string]||""}{hovered.data?.id}</div>}
    </div>
  );
}

function PB({i,o,c}:{i:string;o:()=>void;c?:string}){return<button onClick={o} className={"px-2 py-1 rounded text-xs font-bold "+(c||"bg-gray-800 hover:bg-gray-700 text-gray-300")}>{i}</button>}
function DP({l,v,u,warn,pct,dir,l2}:{l:string;v?:number;u?:string;warn?:boolean;pct?:boolean;dir?:boolean;l2?:string}){if(dir)return<div className="flex justify-between text-[10px]"><span className="text-gray-500">{l}</span><span className="text-gray-200">→{l2}</span></div>;return<div className="flex justify-between text-[10px]"><span className="text-gray-500">{l}</span><span className={warn?"text-red-400":"text-gray-200"}>{pct?(v??0).toFixed(0)+(u||""):(v??0).toFixed(3)+(u?" "+u:"")}</span></div>}
