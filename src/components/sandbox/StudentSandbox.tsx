'use client';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {getAuthToken} from '@/contexts/AppContext';
import {Campus,FACILITIES,Facility,Placement,RunResult,SURFACE_NAMES,Surface} from '@/lib/sandbox/types';
import {calculateEco,ECO_PARAMETERS} from '@/lib/sandbox/ecosystem';
import {planSignature,validatePlacements} from '@/lib/sandbox/model';
import {configKey,groupPlacements,groupSpaces,setGroupArea,spaceId} from '@/lib/sandbox/grouping';
import CampusMap from './CampusMap';
import GroupPlacementEditor from './GroupPlacementEditor';
import type {ViewRequest} from './useSvgViewport';
import ResultChart from './ResultChart';
import styles from './studio.module.css';
const ThreeMap=dynamic(()=>import('./ThreeMap'),{ssr:false,loading:()=> <div className={styles.loading}>正在加载三维场景…</div>});
const KEYS=Object.keys(FACILITIES) as Facility[];
const n=(v:number,d=0)=>v.toLocaleString('zh-CN',{maximumFractionDigits:d});
const money=(v:number)=>Math.abs(v)>=10000?n(v/10000,2)+' 万':n(v,0);
const delta=(base:number,value:number)=>base>1e-9?(base-value)/base*100:null;
function Icon({type,size=22}:{type:string;size?:number}){
 const paths:Record<string,React.ReactNode>={
  GR:<><path d="m3 12 9-8 9 8M6 10v10h12V10"/><path d="M12 13c0-5 5-6 5-6 0 5-5 6-5 6Zm0 0v4"/></>,
  VS:<><path d="M3 17q9 7 18 0M4 8l2 7m3-10v11m6-11v11m3-8-2 7"/></>,
  RG:<><path d="M4 20h16l-2-7H6l-2 7Zm8-7V7m0 3L7 7m5 2 5-4"/><circle cx="12" cy="5" r="2"/></>,
  PP:<><path d="M3 5h18v14H3zM3 12h18M9 5v7m7 0v7"/><path d="m8 20 1 2m6-2 1 2"/></>,
  leaf:<><path d="M20 3C7 2 2 8 5 15s17 5 15-12Z"/><path d="M4 21 16 8"/></>,
  play:<path d="m8 4 12 8-12 8Z"/>,save:<><path d="M5 3h13l3 4v14H3V3h2Zm2 0v7h10V3M7 21v-7h10v7"/></>,
  undo:<path d="M8 4 3 9l5 5M3 9h11a7 7 0 0 1 0 14"/>,download:<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>,
  close:<path d="m6 6 12 12M6 18 18 6"/>,trash:<><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></>,
  layers:<><path d="m2 8 10-5 10 5-10 5L2 8Zm0 5 10 5 10-5M2 18l10 5 10-5"/></>,
  drop:<path d="M12 3C10 7 5 11 5 16a7 7 0 0 0 14 0c0-5-5-9-7-13Z"/>,
  panelLeft:<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m7-11-3 3 3 3"/></>,
  panelRight:<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16m-7-11 3 3-3 3"/></>,
  more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  check:<path d="m5 12 4 4L19 6"/>,
 };
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]||paths.leaf}</svg>;
}
type Saved={id:string;name:string;placements:Placement[];rain:string;result?:RunResult;date:string;};
export default function StudentSandbox({preview=false}:{preview?:boolean}){
 const STORAGE=preview?'zijing-swmm-preview-v1':'zijing-studio-v1';
 const[campus,setCampus]=useState<Campus|null>(null),[loadError,setLoadError]=useState('');
 const[placements,setPlacements]=useState<Placement[]>([]),[zone,setZone]=useState(5),[focusZone,setFocusZone]=useState<number|null>(5),[patchId,setPatchId]=useState(''),[active,setActive]=useState<Facility>('RG');
 const[area,setArea]=useState(50),[depth,setDepth]=useState(100),[trees,setTrees]=useState(true),[rain,setRain]=useState('5A'),[name,setName]=useState('我的方案 01');
 const[view,setView]=useState<'2d'|'3d'>('2d'),[showPipes,setShowPipes]=useState(false),[focusMode,setFocusMode]=useState(false),[libraryOpen,setLibraryOpen]=useState(false),[inspectorOpen,setInspectorOpen]=useState(false),[toast,setToast]=useState(''),[error,setError]=useState('');
 const[result,setResult]=useState<RunResult|null>(null),[running,setRunning]=useState(false),[tab,setTab]=useState('overview'),[pollutant,setPollutant]=useState('COD');
 const[modal,setModal]=useState<'help'|'saved'|'params'|null>(null),[saved,setSaved]=useState<Saved[]>([]);
 const[history,setHistory]=useState<Placement[][]>([]),[future,setFuture]=useState<Placement[][]>([]);
 const[libraryCollapsed,setLibraryCollapsed]=useState(false),[inspectorCollapsed,setInspectorCollapsed]=useState(false),[compactViewport,setCompactViewport]=useState(false),[draggingFacility,setDraggingFacility]=useState(false);
 const drawerMode=focusMode||compactViewport;
 const libraryVisible=drawerMode?libraryOpen:!libraryCollapsed,inspectorVisible=drawerMode?inspectorOpen:!inspectorCollapsed;
 function toggleLibrary(){if(drawerMode){setLibraryOpen(v=>!v);setInspectorOpen(false);}else setLibraryCollapsed(v=>!v);}
 function toggleInspector(){if(drawerMode){setInspectorOpen(v=>!v);setLibraryOpen(false);}else setInspectorCollapsed(v=>!v);}
 function closeDrawers(){setLibraryOpen(false);setInspectorOpen(false);}
 useEffect(()=>{const query=window.matchMedia('(max-width: 1100px)');const update=()=>setCompactViewport(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
 useEffect(()=>{if(!drawerMode||(!libraryOpen&&!inspectorOpen))return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setLibraryOpen(false);setInspectorOpen(false);}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[drawerMode,libraryOpen,inspectorOpen]);
 const[viewRequests,setViewRequests]=useState<Record<'2d'|'3d',ViewRequest>>({'2d':{sequence:1,zone:5},'3d':{sequence:0,zone:null}});
 function switchView(next:'2d'|'3d'){if(next!==view&&viewRequests[next].sequence===0)setViewRequests(previous=>({...previous,[next]:{sequence:1,zone}}));setView(next);}
 function locateView(id:number|null){setFocusZone(id);setViewRequests(previous=>({...previous,[view]:{sequence:previous[view].sequence+1,zone:id}}));}
 const hydrated=useRef(false),fileInput=useRef<HTMLInputElement>(null),previewStarted=useRef(false);
 useEffect(()=>{let alive=true;fetch('/api/sandbox/model').then(r=>{if(!r.ok)throw new Error('场地加载失败');return r.json();}).then((data:Campus)=>{
   if(!alive)return;setCampus(data);const p=data.patches.filter(p=>p.zone===5&&p.surface==='green').sort((a,b)=>b.area-a.area)[0]||data.patches[0];setPatchId(p.id);
   if(preview){setPlacements(data.baseline);setName('SWMM 案例体验');setShowPipes(true);}
   try{const raw=JSON.parse(localStorage.getItem(STORAGE)||'null');if(raw&&validatePlacements(data,raw.placements).errors.length===0){setPlacements(raw.placements);setName(typeof raw.name==='string'?raw.name:'我的方案 01');if(['3A','5A','10A','20A','50A'].includes(raw.rain))setRain(raw.rain);}const s=JSON.parse(localStorage.getItem(STORAGE+'-saved')||'[]');if(Array.isArray(s))setSaved(s.filter(x=>x&&validatePlacements(data,x.placements).errors.length===0).slice(0,8));}catch{}
   hydrated.current=true;
 }).catch(e=>alive&&setLoadError(e.message));return()=>{alive=false;};},[preview,STORAGE]);
 useEffect(()=>{if(preview&&campus&&!previewStarted.current){previewStarted.current=true;void run();}},[preview,campus]);
 useEffect(()=>{if(hydrated.current){try{localStorage.setItem(STORAGE,JSON.stringify({placements,name,rain}));}catch{}}},[placements,name,rain]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(t);},[toast]);
 const eco=useMemo(()=>calculateEco(placements),[placements]);
 const patch=campus?.patches.find(p=>p.id===patchId),zoneData=campus?.zones.find(z=>z.id===zone);
 const spaces=useMemo(()=>campus?groupSpaces(campus):[],[campus]);
 const selectedSpace=spaces.find(s=>s.zone===zone&&s.surface===patch?.surface) || spaces.find(s=>s.zone===zone&&s.surface!=='reserved');
 const selectedSpaceId=selectedSpace?.id||'';
 const spacePatchIds=useMemo(()=>new Set(selectedSpace?.patches.map(p=>p.id)||[]),[selectedSpace]);
 const current=placements.filter(p=>spacePatchIds.has(p.patchId));
 const used=current.reduce((s,p)=>s+p.area,0),available=Math.max(0,(selectedSpace?.area||0)-used);
 const validSurface=selectedSpace?.surface===FACILITIES[active].surface;
 const groupedCurrent=useMemo(()=>campus?groupPlacements(campus,placements).filter(p=>p.spaceId===selectedSpaceId):[],[campus,placements,selectedSpaceId]);
 const signature=planSignature(placements,rain),stale=!!result&&result.signature!==signature;
 const zonePlacements=placements.filter(p=>campus?.patches.find(x=>x.id===p.patchId)?.zone===zone);
 const zoneGroupCount=useMemo(()=>campus?groupPlacements(campus,zonePlacements).length:0,[campus,zonePlacements]);
 const commit=useCallback((next:Placement[])=>{if(!campus)return false;const v=validatePlacements(campus,next);if(v.errors.length){setError(v.errors[0]);return false;}setHistory(h=>[...h.slice(-39),placements]);setFuture([]);setPlacements(v.placements);setError('');return true;},[campus,placements]);
 const selectPatch=useCallback((id:string)=>{const p=campus?.patches.find(p=>p.id===id);if(p){setZone(p.zone);setPatchId(id);setError('');}},[campus]);
 function selectZone(id:number){setZone(id);locateView(id);const ps=campus?.patches.filter(p=>p.zone===id)||[];const p=[...ps].filter(p=>p.surface===FACILITIES[active].surface).sort((a,b)=>b.area-a.area)[0]||ps.find(p=>p.surface!=='reserved')||ps[0];if(p)setPatchId(p.id);setError('');}
 function enterFocus(){setFocusMode(true);setLibraryOpen(false);setInspectorOpen(false);}
 function exitFocus(){setFocusMode(false);setLibraryOpen(false);setInspectorOpen(false);}
 function showGlobal(){locateView(null);}
 function tool(f:Facility){setActive(f);setDepth(FACILITIES[f].depth);setError('');}
 const applyGroup=useCallback((spaceIdValue:string,config:{facility:Facility;depth:number;trees:boolean},total:number)=>{
   if(!campus)return false;const space=spaces.find(s=>s.id===spaceIdValue);if(!space)return false;
   try{const next=setGroupArea(campus,placements,space,config,total);return commit(next);}catch(e){setError(e instanceof Error?e.message:'无法调整片区合计面积');return false;}
 },[campus,spaces,placements,commit]);
 const addAt=useCallback((id:string,f:Facility,requested?:number)=>{
   if(!campus)return;const p=campus.patches.find(p=>p.id===id);if(!p)return;selectPatch(id);setActive(f);
   if(p.surface!==FACILITIES[f].surface){setError(`${SURFACE_NAMES[p.surface]}不能布置${FACILITIES[f].name}。请选择${SURFACE_NAMES[FACILITIES[f].surface]}。`);return;}
   const space=spaces.find(s=>s.id===spaceId(p.zone,p.surface));if(!space)return;
   const usedSpace=placements.filter(x=>space.patches.some(sp=>sp.id===x.patchId)).reduce((s,x)=>s+x.area,0);
   const free=Math.max(0,space.area-usedSpace), config={facility:f,depth:requested===undefined?FACILITIES[f].depth:depth,trees:f==='RG'&&trees};
   const previous=groupPlacements(campus,placements).find(x=>x.spaceId===space.id&&configKey(x)===configKey(config))?.area||0;
   const a=requested??Math.min(50,Math.floor(free*.5*100)/100);
   if(a<=0||a>free+.001){setError(`此片区${SURFACE_NAMES[p.surface]}剩余 ${n(free,2)} m²，请减少面积或调整已有设施。`);return;}
   if(applyGroup(space.id,config,previous+a))setToast(`已添加 ${n(a,2)} m² ${FACILITIES[f].name}，已按片区同类空间分配。`);
 },[campus,placements,spaces,applyGroup,selectPatch,depth,trees]);
 function undo(){if(!history.length)return;setFuture(f=>[placements,...f]);setPlacements(history[history.length-1]);setHistory(h=>h.slice(0,-1));setError('');}
 function redo(){if(!future.length)return;setHistory(h=>[...h,placements]);setPlacements(future[0]);setFuture(f=>f.slice(1));setError('');}
 function resetPlan(){
   if(running||(!placements.length&&!result))return;
   const hadPlacements=placements.length>0;
   if(hadPlacements&&!commit([]))return;
   setResult(null);setError('');
   setToast(hadPlacements?'当前方案已重置，可点击“撤销”恢复设施配置。':'已清除当前方案的计算结果。');
 }
 async function run(){setRunning(true);setError('');try{
   const r=await fetch('/api/sandbox/run',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+getAuthToken()},body:JSON.stringify({placements,rain})});const data=await r.json();if(!r.ok)throw new Error(data.error||'计算失败');setResult(data);setTab('overview');setToast('计算完成，可以查看结果和对比曲线。');
 }catch(e){setError(e instanceof Error?e.message:'计算失败');}finally{setRunning(false);}}
 function save(){const item:Saved={id:crypto.randomUUID(),name:name||'未命名方案',placements:structuredClone(placements),rain,result:result&&!stale?result:undefined,date:new Date().toLocaleString('zh-CN')};const next=[item,...saved].slice(0,8);try{localStorage.setItem(STORAGE+'-saved',JSON.stringify(next));setSaved(next);setToast('方案和有效计算结果已保存在本机。');}catch{setError('浏览器存储空间不足，请导出方案文件。');}}
 function download(value:string,filename:string,type='application/json'){const url=URL.createObjectURL(new Blob([value],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function exportInp(){try{const r=await fetch('/api/sandbox/run',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+getAuthToken()},body:JSON.stringify({placements,rain,export:true})});if(!r.ok)throw new Error((await r.json()).error);download(await r.text(),'zijing-student.inp','text/plain');}catch(e){setError(String(e));}}
 async function importFile(file?:File){if(!file||!campus)return;try{const data=JSON.parse(await file.text());if(data.version!==campus.version||!['3A','5A','10A','20A','50A'].includes(data.rain))throw new Error('请选择本沙盘导出的方案文件。');if(commit(data.placements)){setRain(data.rain);setName(String(data.name||'导入方案').slice(0,60));setToast('方案已导入。');}}catch(e){setError(e instanceof Error?e.message:'无法读取方案');}if(fileInput.current)fileInput.current.value='';}
 if(!campus)return <div className={styles.loading}><Icon type="leaf" size={32}/><h2>{loadError||'正在打开紫荆雅苑…'}</h2>{loadError&&<button onClick={()=>location.reload()}>重新加载</button>}</div>;
 return <div className={styles.studio}>
  <div className={styles.workbench}>
  <div className={styles.toolbar}>
   <div className={styles.planName}><span className={styles.brandIcon}><Icon type="layers" size={22}/></span><div className={styles.planIdentity}><h1>海绵城市沙盘</h1><div className={styles.planSubtitle}><span>紫荆雅苑</span><span aria-hidden="true">·</span><input aria-label="方案名称" title="编辑当前方案名称" maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></div></div><span className={styles.draftStatus}><span className={styles.liveDot}/>草稿自动保存</span></div>
   <div className={styles.toolbarRight}><button className={styles.undoButton} aria-label="撤销" title="撤销上次配置" onClick={undo} disabled={!history.length}><Icon type="undo" size={16}/><span>撤销</span></button><div className={styles.planActions}><button className={styles.save} onClick={save}><Icon type="save" size={16}/>保存方案</button><button className={styles.save} title="清空所有片区的设施配置，可撤销" onClick={resetPlan} disabled={running||(!placements.length&&!result)}>重置方案</button></div><i/><label><span>降雨情景</span><select aria-label="降雨情景" value={rain} onChange={e=>setRain(e.target.value)}>{[3,5,10,20,50].map(y=><option key={y} value={y+'A'}>{y} 年一遇</option>)}</select></label><button className={styles.run} onClick={run} disabled={running}><Icon type="play" size={15}/>{running?'正在计算…':'运行计算'}</button><details className={styles.moreMenu}><summary aria-label="更多操作" title="更多操作"><Icon type="more" size={20}/></summary><div><button onClick={()=>setModal('saved')}>我的实验 <span className={styles.count}>{saved.length}</span></button><button onClick={()=>setModal('help')}>使用指南</button><button aria-label="重做" onClick={redo} disabled={!future.length}>重做上次配置</button></div></details></div>
  </div>
  {preview&&<div className={styles.previewBanner}><div><strong>SWMM 实算体验 · 紫荆雅苑案例</strong><p>首次打开自动载入四类设施并运行 5 年一遇降雨。可修改配置后重新计算；此处的草稿和保存方案独立存储。</p></div><div><a href="#sandbox-results">查看计算结果 ↓</a><Link href="/sandbox">返回我的沙盘 ↗</Link></div></div>}
  <div className={`${styles.workspace} ${drawerMode?styles.workspaceFocus:''} ${!libraryVisible?styles.libraryCollapsed:''} ${!inspectorVisible?styles.inspectorCollapsed:''}`}>
   {compactViewport&&(libraryVisible||inspectorVisible)&&!draggingFacility&&<button className={styles.drawerShade} aria-label="关闭侧边面板" onClick={closeDrawers}/>}
   
   <aside id="sandbox-library" aria-label="设施工具箱面板" className={`${styles.library} ${!libraryVisible?styles.drawerClosed:''}`}>
    <div className={styles.panelHeading}><h2>设施工具箱 <span className={styles.panelCount}>04</span></h2><button className={styles.panelClose} aria-label="关闭设施工具箱" title="收起设施工具箱" onClick={toggleLibrary}><Icon type="panelLeft" size={17}/></button></div><p className={styles.hint}>选择设施，拖入适宜空间</p>
    <div className={styles.facilities}>{KEYS.map(f=>{const item=FACILITIES[f];return <button key={f} draggable onDragStart={e=>{e.dataTransfer.setData('application/x-lid',f);e.dataTransfer.effectAllowed='copy';setDraggingFacility(true);tool(f);}} onDragEnd={()=>setDraggingFacility(false)} onClick={()=>tool(f)} aria-pressed={active===f} className={`${styles.facility} ${active===f?styles.facilityActive:''}`} style={{'--facility-color':item.color} as React.CSSProperties}>
      <div className={styles.facilityTop}><span className={styles.facilityIcon}><Icon type={f} size={24}/></span><div className={styles.facilityName}><strong>{item.name}</strong><small>{item.english}</small></div><span className={styles.facilityCode}>{f}</span></div><p>{item.description}</p><div className={styles.facilityFoot}><span>{SURFACE_NAMES[item.surface]}适用</span><span>{active===f?<><Icon type="check" size={13}/>已选择</>:'选择设施 ↗'}</span></div>
     </button>;})}</div>
    <div className={styles.libraryNote}><Icon type="layers" size={18}/><div><strong>按片区统一配置</strong><p>同一片区同色空间自动合并；多种设施仍共享可用面积。</p></div></div>
    <button className={styles.textButton} onClick={()=>{if(commit(campus.baseline))setToast('已载入案例中的四类设施，可继续调整。');}}>载入案例四类设施 →</button>
    {!preview&&<Link className={styles.textButton} href="/sandbox/demo">打开 SWMM 案例体验 ↗</Link>}
    <Link className={styles.textButton} href="/sandbox/legacy">查看原版管网沙盘 ↗</Link>
   </aside>
   <section className={styles.mapColumn}>
    <div className={styles.mapHeading}><div><h2>{focusMode?'专注编辑':'社区空间'} <span> Z{String(zone).padStart(2,'0')} · {zoneData?.name}</span></h2><p>把想法，种进这片社区。</p></div><div className={styles.viewToggle}><button aria-pressed={view==='2d'} onClick={()=>switchView('2d')}>俯视编辑</button><button aria-pressed={view==='3d'} onClick={()=>switchView('3d')}>三维查看</button></div></div>
    <div className={styles.mapActions}><div className={styles.panelToggles}>{!libraryVisible&&<button className={styles.mapAction} onClick={toggleLibrary} aria-expanded={false} aria-controls="sandbox-library"><Icon type="panelLeft" size={15}/>设施工具箱</button>}{!inspectorVisible&&<button className={styles.mapAction} onClick={toggleInspector} aria-expanded={false} aria-controls="sandbox-inspector"><Icon type="panelRight" size={15}/>空间配置</button>}</div><button className={styles.mapActionPrimary} onClick={focusMode?exitFocus:enterFocus}>{focusMode?'退出专注':'专注编辑 ↗'}</button></div>
    <div className={styles.zoneNav}><span>选择片区</span><div className={styles.zoneStrip} aria-label="选择教学片区">{campus.zones.map(z=><button key={z.id} aria-pressed={zone===z.id} onClick={()=>selectZone(z.id)} title={`${z.name} · 点击自动放大`}>Z{String(z.id).padStart(2,'0')}{placements.some(p=>campus.patches.find(x=>x.id===p.patchId)?.zone===z.id)&&<i/>}</button>)}</div><span className={styles.zoneNavHint}>{focusZone?`定位片区 Z${String(focusZone).padStart(2,'0')}`:'点击片区按钮定位；点击对象只选中'}</span></div>
    <div className={styles.mapBody}>
      <div className={styles.viewLayer} hidden={view!=='2d'}><CampusMap campus={campus} placements={placements} zone={zone} viewRequest={viewRequests['2d']} disabled={!!modal||view!=='2d'||(compactViewport&&(libraryVisible||inspectorVisible)&&!draggingFacility)} patch={patchId} active={active} showPipes={showPipes} step={0} depths={!stale?result?.proposed.nodeDepth:undefined} onSelect={selectPatch} onDropFacility={addAt} onViewAll={showGlobal}/></div>
      <div className={styles.viewLayer} hidden={view!=='3d'}><ThreeMap campus={campus} placements={placements} viewRequest={viewRequests['3d']} disabled={!!modal||view!=='3d'||(compactViewport&&(libraryVisible||inspectorVisible))} selected={patchId} onSelect={selectPatch} onViewAll={showGlobal}/></div>
      <div className={styles.mapBadge}><span className={styles.liveDot}/>Z{String(zone).padStart(2,'0')} · {zoneData?.name}<span>{n(zoneData?.area||0)} m²</span></div>
      {focusMode&&<div className={styles.focusHint}><strong>专注编辑</strong><span>滚轮缩放 · 空格 + 左键平移 · 点击选中</span></div>}
    </div>
    <div className={styles.mapBottom}><div className={styles.legend}>{(['roof','road','green','reserved'] as Surface[]).map(t=><span key={t}><i className={styles[t]}/>{SURFACE_NAMES[t]}</span>)}</div><label className={styles.check}><input type="checkbox" checked={showPipes} onChange={e=>setShowPipes(e.target.checked)} disabled={view==='3d'}/>排水管网</label></div>
    <div className={styles.designSummary}><div><span>已布置面积</span><strong>{n(eco.area)}<small> m²</small></strong></div><div><span>设施组合</span><strong>{KEYS.filter(f=>eco.byFacility[f]>0).length}<small> / 4 类</small></strong></div><div><span>预计建设投入</span><strong>{money(eco.construction)}<small> 元</small></strong></div><button onClick={()=>setModal('params')}>查看计算依据 ↗</button></div>
   </section>
   <aside id="sandbox-inspector" aria-label="空间配置面板" className={`${styles.inspector} ${!inspectorVisible?styles.drawerClosed:''}`}>
    <div className={styles.panelHeading}><h2>空间配置</h2><button className={styles.panelClose} aria-label="关闭空间配置" title="收起空间配置" onClick={toggleInspector}><Icon type="panelRight" size={17}/></button></div>
    <div className={styles.zoneIdentity}><span className={styles.zoneChip}>Z{String(zone).padStart(2,'0')}</span><h3 className={styles.zoneTitle}>{zoneData?.name}</h3><span className={styles.configStatus}>{zoneGroupCount?'已配置':'待配置'}</span></div><p className={styles.hint}>选择一类空间，统一配置同类地块。</p>
    <div className={styles.capacityCards}>{(['roof','road','green'] as Surface[]).map(t=>{const space=spaces.find(s=>s.id===spaceId(zone,t));return <button key={t} aria-pressed={selectedSpace?.surface===t} onClick={()=>{const p=space?.patches.slice().sort((a,b)=>b.area-a.area)[0];if(p)selectPatch(p.id);}} disabled={!space}><i className={styles[t]}/><span>全部{SURFACE_NAMES[t]}</span><strong>{n(space?.area||0)}<small> m²</small></strong></button>;})}</div>
    <div className={styles.spaceSelection}><span>当前统一空间</span><strong>{selectedSpace?`Z${String(zone).padStart(2,'0')} · 全部${SURFACE_NAMES[selectedSpace.surface]}`:'暂无可编辑空间'}</strong><small>{selectedSpace?`${selectedSpace.patches.length} 块模型地块 · 合计 ${n(selectedSpace.area)} m²`:''}</small><select className={styles.srOnly} aria-label="当前空间" value={patchId} onChange={e=>selectPatch(e.target.value)}>{campus.patches.filter(p=>p.zone===zone).map(p=><option key={p.id} value={p.id}>{p.id} · {SURFACE_NAMES[p.surface]}</option>)}</select></div>
    <div className={styles.spaceUsage}><span>剩余可用面积 <small>已使用 {n(used/(selectedSpace?.area||1)*100,1)}%</small></span><strong>{n(available,1)}<small> / {n(selectedSpace?.area||0,1)} m²</small></strong><div role="progressbar" aria-label="空间面积使用率" aria-valuenow={Math.round(used/(selectedSpace?.area||1)*100)} aria-valuemin={0} aria-valuemax={100}><i style={{width:`${Math.min(100,used/(selectedSpace?.area||1)*100)}%`}}/></div></div>
    <div className={styles.addPanel}><div className={styles.addTitle}><span style={{color:FACILITIES[active].color}}><Icon type={active} size={20}/></span><strong>添加{FACILITIES[active].name}</strong></div>
     <div className={styles.twoFields}><label className={styles.field}>占地面积 / m²<input aria-label="设施占地面积" type="number" min="0.01" max={available} step="1" value={area} onChange={e=>setArea(Number(e.target.value))}/></label><label className={styles.field}>蓄水深度 / mm<input aria-label="设施蓄水深度" type="number" min="20" max="300" step="5" value={depth} onChange={e=>setDepth(Number(e.target.value))}/></label></div>
     <div className={styles.quickSizes}>{[.25,.5,1].map(f=><button key={f} onClick={()=>setArea(Math.floor(available*f*100)/100)}>{f===1?'剩余全部':`剩余 ${f*100}%`}</button>)}</div>
     {active==='RG'&&<label className={styles.check}><input type="checkbox" checked={trees} onChange={e=>setTrees(e.target.checked)}/>包含乔木配置</label>}
     {!validSurface&&<p className={styles.constraint}>{FACILITIES[active].name}只可布置于{SURFACE_NAMES[FACILITIES[active].surface]}，当前为{selectedSpace&&SURFACE_NAMES[selectedSpace.surface]}。</p>}
     <button className={styles.addButton} disabled={!validSurface||available<=.01||running} onClick={()=>addAt(patchId,active,area)}>＋ 添加到当前空间</button>
    </div>
    <div className={styles.listHeading}><h3>已配置设施</h3><span>{groupedCurrent.length} 类配置</span></div>
    <div className={styles.placementList}>{groupedCurrent.length?groupedCurrent.map(item=><GroupPlacementEditor key={item.key} item={item} available={available} disabled={running} onApply={value=>{if(applyGroup(item.spaceId,{facility:item.facility,depth:item.depth,trees:item.trees},value))setToast(`已更新${FACILITIES[item.facility].name}合计面积。`);}} onRemove={()=>{if(applyGroup(item.spaceId,{facility:item.facility,depth:item.depth,trees:item.trees},0))setToast(`已移除${FACILITIES[item.facility].name}配置。`);}}/>):<div className={styles.emptySmall}>这里还没有设施<br/><span>从左侧选择，开始你的设计</span></div>}</div>
    <div className={styles.zoneTotal}>本片区 <strong>{zoneGroupCount}</strong> 类配置 · 合计 <strong>{n(zonePlacements.reduce((s,p)=>s+p.area,0))}</strong> m²</div>
   </aside>
  </div>
  {(error||toast)&&<div className={`${styles.notice} ${error?styles.noticeError:''}`} role={error?'alert':'status'}><span>{error||toast}</span><button aria-label="关闭提示" onClick={()=>{setError('');setToast('');}}><Icon type="close" size={16}/></button></div>}
  <section id="sandbox-results" className={styles.results}>
   <div className={styles.resultTop}><div className={styles.tabs}>{[['overview','结果总览'],['hydro','径流与积水'],['quality','水质控制'],['eco','生态服务'],['compare','方案对比']].map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</div><div className={styles.resultStatus}>{running?<><span className={styles.spinner}/>正在运行真实 SWMM…</>:result?<><span className={styles.liveDot}/>{stale?'方案已修改 · 请重新计算':'SWMM 计算完成'}</>:<><span className={styles.neutralDot}/>等待运行</>}</div></div>
   {stale&&<div className={styles.stale}>以下水文结果对应上次运行的方案。点击“运行计算”更新。</div>}
   {result&&tab==='quality'&&Math.max(Math.abs(result.baseline.continuity.quality),Math.abs(result.proposed.continuity.quality))>10&&<div className={styles.stale} role="status">本次水质质量平衡误差较大：基准 {n(result.baseline.continuity.quality,2)}%，当前方案 {n(result.proposed.continuity.quality,2)}%。水质结果仅供教学观察，需校核模型后再用于定量评估。</div>}
   {tab==='eco'?<div className={styles.ecoContent}><div className={styles.ecoHero}><span>年度生态系统服务价值 · 教学估值</span><strong>¥ {money(eco.annual.total)}<small> / 年</small></strong><p>30 年生态价值现值 ¥ {money(eco.lifecycleValue)}<br/>扣除建设隐含碳排放价值，成本另列</p></div><div className={styles.ecoGrid}>{[
    ['净碳汇','carbon','年净碳量',n(eco.physical.carbonKg,1),'kg CO₂'],
    ['温度调节','cooling','等效节电',n(eco.physical.electricityKwh),'kWh/年'],
    ['空气净化','air','SO₂ 削减量',n(eco.physical.so2Kg,2),'kg/年'],
    ['吸声降噪','noise','等效树木带',n(eco.physical.noiseLength,1),'m'],
   ].map(([label,key,metric,value,unit])=><div key={key} role="group" aria-label={label}><span>{label}</span><strong className={styles.ecoMetric}><span>{metric}</span><span>{value}<small> {unit}</small></span></strong><p>生态服务价值 ¥ {money(eco.annual[key as 'carbon'|'cooling'|'air'|'noise'])} / 年</p></div>)}</div><button className={styles.textButton} onClick={()=>setModal('params')}>展开全部参数、公式与估值假设 ↗</button></div>
   :tab==='compare'?<div className={styles.compareContent}><div className={styles.compareHead}><h3>每一次尝试，都值得比较。</h3><button className={styles.save} onClick={save}>保存当前方案</button></div>{saved.length?<div className={styles.tableScroll}><table><thead><tr><th>方案</th><th>降雨</th><th>布置面积</th><th>年生态价值</th><th>峰值流量</th><th>操作</th></tr></thead><tbody>{saved.map(s=><tr key={s.id}><td>{s.name}</td><td>{s.rain.replace('A',' 年一遇')}</td><td>{n(calculateEco(s.placements).area)} m²</td><td>¥ {money(calculateEco(s.placements).annual.total)}</td><td>{s.result?n(s.result.proposed.peakFlow,3)+' m³/s':'未计算'}</td><td><button className={styles.textButton} onClick={()=>{commit(s.placements);setName(s.name);setRain(s.rain);setResult(s.result||null);setToast('方案已恢复');}}>恢复方案</button></td></tr>)}</tbody></table><p className={styles.hint}>仅对相同降雨条件下的水文、水质结果进行比较。</p></div>:<p className={styles.hint}>保存两个或更多方案，即可比较不同布置的表现。</p>}</div>
   :!result?<div className={styles.emptyResults}><span><Icon type="drop" size={30}/></span><div><h3>{running?'雨水正在流经你的设计…':'先布置，再看看一场雨会发生什么。'}</h3><p>运行后查看径流、污染负荷、管网水位与生态收益。生态服务页可随设计即时查看估值。</p></div><button onClick={run} disabled={running} className={styles.run}>{running?'计算中…':'运行第一场雨 →'}</button></div>
   :<div className={styles.calculated}>
    <div className={styles.metrics}>{[
     ['径流削减率',delta(result.baseline.runoffVolume,result.proposed.runoffVolume),'%',`基准 ${n(result.baseline.runoffVolume)} → ${n(result.proposed.runoffVolume)} m³`],
     ['峰值出流',result.proposed.peakFlow,'m³/s',`基准 ${n(result.baseline.peakFlow,3)} m³/s`],
     ['节点洪泛量',result.proposed.floodVolume,'m³',`基准 ${n(result.baseline.floodVolume)} m³`],
     ['年生态服务价值',result.eco.annual.total,'元/年','基于年度气象与教学参数'],
    ].map(([label,value,unit,note])=><div key={String(label)}><span>{label}</span><strong>{value===null?'—':n(value as number,unit==='m³/s'?3:1)}<small> {unit}</small></strong><p>{note}</p></div>)}</div>
    {tab==='quality'?<><div className={styles.pollutantPicker}>{['COD','TN','TP'].map(p=><button key={p} aria-pressed={p===pollutant} onClick={()=>setPollutant(p)}>{p}</button>)}<span>全事件出水口负荷：{n(result.proposed.pollutants[pollutant]?.load||0,3)} kg · 基准 {n(result.baseline.pollutants[pollutant]?.load||0,3)} kg</span></div><ResultChart a={result.baseline.pollutants[pollutant]?.concentration||[]} b={result.proposed.pollutants[pollutant]?.concentration||[]} times={result.proposed.times} label={pollutant+' 出水口流量加权浓度'} unit="mg/L"/></>:<ResultChart a={result.baseline.outflow} b={result.proposed.outflow} times={result.proposed.times} label="出水口流量过程对比" unit="m³/s"/>}
    <details className={styles.resultDetails}><summary>计算来源与模型说明</summary>{result.warnings.map(w=><p key={w}>{w}</p>)}<p>引擎版本 {result.proposed.engine} · 连续性误差：径流 {n(result.proposed.continuity.runoff,3)}%，管网 {n(result.proposed.continuity.routing,3)}%，水质 {n(result.proposed.continuity.quality,3)}%。</p><p>区域径流量：{Object.entries(result.proposed.zoneRunoff).map(([z,v])=>`Z${z.padStart(2,'0')} ${n(v)} m³`).join(' · ')}</p></details>
   </div>}
  </section>
  <footer className={styles.footer}><span>紫荆雅苑 · 海绵城市规划实验</span><span>真实 SWMM 水文计算 / 生态服务为教学估值</span><div><button onClick={()=>download(JSON.stringify({version:campus.version,name,placements,rain},null,2),'zijing-plan.json')}>导出方案</button><button onClick={()=>fileInput.current?.click()}>导入方案</button><button onClick={exportInp}>导出 INP</button><input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={e=>importFile(e.target.files?.[0])}/></div></footer>
  {modal&&<div className={styles.modalBackdrop} onClick={()=>setModal(null)}><section className={styles.modal} role="dialog" aria-modal="true" aria-label={modal==='params'?'计算依据':modal==='saved'?'我的实验':'使用指南'} onClick={e=>e.stopPropagation()}><button className={styles.closeModal} aria-label="关闭窗口" onClick={()=>setModal(null)}><Icon type="close"/></button>
   {modal==='help'?<><span className={styles.eyebrow}>YOUR FIRST EXPERIMENT</span><h2>从一块绿地，开始改变。</h2><ol className={styles.helpSteps}><li><strong>选一个片区</strong><p>用 Z01–Z10 按钮定位片区，单击屋顶、道路或绿地会选中该片区的整类空间。滚轮缩放；空白处左键拖动，空格 + 左键可从任意位置平移。点击沙盘后可用方向键 / WASD 连续移动（Shift 加速），+ / − 缩放，R 重置，Esc 取消拖动。灰色保留空间没有足够分类依据，暂不可布置。</p></li><li><strong>组合你的设施</strong><p>从左侧拖入设施，或右侧设定片区合计面积后添加。程序会把合计面积按可用容量分配到原有模型地块；屋顶和地面分别计算容量，雨水花园与植草沟可在同一绿地分占面积。</p></li><li><strong>运行一场雨</strong><p>选择降雨情景运行 SWMM，与“未布置可编辑设施”的课程基准比较。支持同区并联组合；本版不提供任意串联接线。</p></li><li><strong>保存、调整、再比较</strong><p>每个方案保留配置、降雨和有效计算结果。草稿自动存储于本机，可导出后带走。</p></li></ol><button className={styles.run} onClick={()=>setModal(null)}>开始我的实验 →</button></>
   :modal==='saved'?<><span className={styles.eyebrow}>EXPERIMENT NOTEBOOK</span><h2>我的实验</h2>{saved.length?saved.map(s=><div key={s.id} className={styles.savedRow}><div><strong>{s.name}</strong><p>{s.date} · {s.rain.replace('A',' 年一遇')} · {n(calculateEco(s.placements).area)} m²</p></div><button className={styles.save} onClick={()=>{commit(s.placements);setName(s.name);setRain(s.rain);setResult(s.result||null);setModal(null);}}>打开</button><button aria-label={'删除保存的'+s.name} onClick={()=>{const next=saved.filter(v=>v.id!==s.id);setSaved(next);localStorage.setItem(STORAGE+'-saved',JSON.stringify(next));}}><Icon type="trash" size={17}/></button></div>):<p>还没有保存的实验。点击右上角“保存方案”记录一次尝试。</p>}</>
   :<><span className={styles.eyebrow}>METHODS & ASSUMPTIONS</span><h2>看见每个数字的来处</h2><p>水文、水质来自案例 INP 经空间配置后的 SWMM 引擎。十区是教学分区，屋顶轮廓来自对应汇水多边形；三维高度为示意。生态核算采用 <strong>{ECO_PARAMETERS.version}</strong> 参数集，用于比较方案，非论文原值复现。</p>
    <h3>生态服务计算口径</h3><ul><li>年度净碳汇＝植被年固碳 − 年维护排放；乘 60 元/t CO₂。建设隐含碳在生命周期价值中一次扣除。</li><li>温度调节＝年蒸散水量 × [汽化潜热 / (3600 × 空调能效比) + 增湿电耗] × 电价。</li><li>空气净化＝植被面积 × SO₂ / 粉尘年削减系数 × 治理单价，kg 与 t 统一换算。</li><li>降噪采用假设乔木带的等效隔声墙替代成本，按 20 年寿命年化；不直接套用论文有量纲疑点的根号公式。</li></ul>
    <div className={styles.tableScroll}><table><thead><tr><th>参数</th><th>取值</th><th>依据</th></tr></thead><tbody>{[['核算期 / 折现率','30 年 / 3.5%','论文参考，课程统一口径'],['电价 / 碳价','0.488 元/kWh / 60 元/t','论文采用值'],['年参考蒸散','450 mm/年','教学假设，非现场实测'],['植被 / 铺装蒸散比例','0.75 / 0.25','教学假设'],['年固碳 GR / VS / RG','0.35 / 0.25 / 0.30 kg/m²','教学假设；RG 含乔木为 0.80'],['有效植被比例','GR、VS 80%；RG 85%','教学假设'],['SO₂ / 滞尘系数','140.62 kg/ha·年 / 10.9 t/ha·年','论文参数'],['治理单价 SO₂ / 粉尘','600 / 150 元/t','论文参数'],['乔木带宽度 / 面积比例','5 m / RG 面积的 15%','教学假设'],['隔声墙单价','425 元/m','论文采用值']].map(r=><tr key={r[0]}>{r.map(c=><td key={c}>{c}</td>)}</tr>)}</tbody></table></div>
    <h3>设施成本与碳排放（教学假设）</h3><div className={styles.tableScroll}><table><thead><tr><th>设施</th><th>建设 元/m²</th><th>维护 元/m²·年</th><th>建设碳 kg/m²</th><th>维护碳 kg/m²·年</th></tr></thead><tbody>{KEYS.map(f=><tr key={f}><td>{FACILITIES[f].name}</td><td>{FACILITIES[f].cost}</td><td>{FACILITIES[f].maintenance}</td><td>{FACILITIES[f].embodied}</td><td>{FACILITIES[f].annualEmission}</td></tr>)}</tbody></table></div><p>设施并联后的各结果由模型联合计算，不能把单设施削减率相加。雨水再利用减排暂未计入，因为蓄水不等于实际回用。</p><p>本方案建设 ¥ {money(eco.construction)}，年维护 ¥ {money(eco.maintenance)}，30 年生命周期成本现值 ¥ {money(eco.lifecycleCost)}。</p>
   </>}
  </section></div>}
  </div>
 </div>;
}
