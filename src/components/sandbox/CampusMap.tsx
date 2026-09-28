'use client';
import React,{useMemo} from 'react';
import { Campus,FACILITIES,Facility,Placement,Surface } from '@/lib/sandbox/types';
import { boundsOf, paddedViewBox } from '@/lib/sandbox/viewport';
import useSvgViewport, { ViewRequest } from './useSvgViewport';
import ViewportControls from './ViewportControls';
import styles from './studio.module.css';
const COLORS:Record<Surface,string>={roof:'#bbc9c8',road:'#e3dac8',green:'#c3d9b4',reserved:'#e9eee7'};
export default function CampusMap({campus,placements,zone,viewRequest,disabled,patch,active,showPipes,step,depths,onSelect,onDropFacility,onViewAll}:{campus:Campus;placements:Placement[];zone:number;viewRequest:ViewRequest;disabled:boolean;patch:string;active:Facility|null;showPipes:boolean;step:number;depths?:Record<string,number[]>;onSelect:(id:string)=>void;onDropFacility:(id:string,f:Facility)=>void;onViewAll:()=>void}){
  const targetBounds=useMemo(()=>boundsOf(campus.patches.filter(p=>viewRequest.zone===null||p.zone===viewRequest.zone).flatMap(p=>p.points)),[campus,viewRequest.zone]);
  const controls=useSvgViewport({bounds:campus.bounds,targetBounds,request:viewRequest,disabled});
  const occupied=useMemo(()=>{const m=new Map<string,Placement[]>();for(const p of placements)m.set(p.patchId,[...(m.get(p.patchId)||[]),p]);return m;},[placements]);
  const selectedPatch=campus.patches.find(p=>p.id===patch);
  function drop(e:React.DragEvent<SVGSVGElement>){e.preventDefault();if(!controls.canDrop())return;const f=e.dataTransfer.getData('application/x-lid') as Facility;if(!FACILITIES[f])return;const el=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-patch]');if(el&&e.currentTarget.contains(el))onDropFacility(el.getAttribute('data-patch')!,f);}
  return <div className={styles.mapCanvas}>
    <svg ref={controls.svg} viewBox={paddedViewBox(campus.bounds)} tabIndex={disabled?-1:0} role="img" aria-label="紫荆雅苑二维沙盘" aria-describedby="sandbox-2d-help" data-testid="sandbox-2d" data-dragging={controls.dragging} data-space={controls.spaceDown} {...controls.handlers} onDragOver={e=>{if(controls.canDrop()){e.preventDefault();e.dataTransfer.dropEffect='copy';}}} onDrop={drop}>
      <desc id="sandbox-2d-help">滚轮缩放，空白处拖动；空格加左键可从对象上拖动。方向键或 WASD 平移，Shift 加速，R 重置，Esc 取消。</desc>
      <defs>
        <pattern id="campus-dots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".35" fill="#91a28b" opacity=".3"/></pattern>
        <pattern id="paving-texture" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 0H5V5" fill="none" stroke="#8f8a73" strokeWidth=".35"/></pattern>
        <filter id="roof-shadow"><feDropShadow dx="1.1" dy="2" stdDeviation=".65" floodColor="#47513d" floodOpacity=".18"/></filter>
      </defs>
      <g data-camera="2d" transform={controls.transform}>
        {campus.patches.map(p=>{
          const list=occupied.get(p.id)||[],used=list.reduce((s,x)=>s+x.area,0),selected=!!selectedPatch&&p.zone===selectedPatch.zone&&p.surface===selectedPatch.surface,compatible=!active||FACILITIES[active].surface===p.surface;
          const pts=p.points.map(v=>v.join(',')).join(' ');
          return <g key={p.id} data-patch={p.id} data-space-group={`${p.zone}-${p.surface}`} data-surface={p.surface} data-selected={selected} className={styles.mapPatch} onClick={()=>onSelect(p.id)}>
            <polygon points={pts} fill={COLORS[p.surface]} stroke={selected?'#3166ff':p.zone===zone?'#8eac99':'#f6f8f5'} strokeWidth={selected?0.7:p.zone===zone?0.45:0.28} opacity={active&&!compatible?0.64:1} filter={p.surface==='roof'?'url(#roof-shadow)':undefined}>
              <title>{`Z${String(p.zone).padStart(2,'0')} · 全部${p.surface==='reserved'?'保留空间':p.surface==='roof'?'屋顶':p.surface==='road'?'道路铺装':'绿地'} · ${p.area.toFixed(0)} m²${used?` · 已布置 ${used.toFixed(0)} m²`:''}`}</title>
            </polygon>
            {!!list.length&&<><clipPath id={`clip-${p.id}`}><polygon points={pts}/></clipPath><g clipPath={`url(#clip-${p.id})`} pointerEvents="none">{list.map((x,i)=>{
              const minX=Math.min(...p.points.map(v=>v[0])),maxX=Math.max(...p.points.map(v=>v[0])),minY=Math.min(...p.points.map(v=>v[1])),maxY=Math.max(...p.points.map(v=>v[1]));
              const offset=list.slice(0,i).reduce((s,v)=>s+v.area,0)/p.area;
              return <g key={x.id}><rect x={minX+(maxX-minX)*offset} y={minY} width={(maxX-minX)*x.area/p.area} height={maxY-minY} fill={FACILITIES[x.facility].color} opacity=".86"/>{x.facility==='PP'&&<rect x={minX+(maxX-minX)*offset} y={minY} width={(maxX-minX)*x.area/p.area} height={maxY-minY} fill="url(#paving-texture)"/>}</g>;
            })}</g></>}
            {selected&&<polygon points={pts} fill="none" stroke="#3166ff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
          </g>;
        })}
        {showPipes&&<g pointerEvents="none">{campus.pipes.map(p=><polyline key={p.id} points={p.points.map(v=>v.join(',')).join(' ')} stroke="#528593" strokeWidth=".8" fill="none" opacity=".75"/>)}{campus.nodes.map(n=><circle key={n.id} cx={n.point[0]} cy={n.point[1]} r={n.outfall?2:1} fill={n.outfall?'#235863':'#779fab'}/>)}</g>}
        {depths&&campus.nodes.map(n=>{const d=depths[n.id]?.[step]||0;return d>.2?<circle key={n.id} cx={n.point[0]} cy={n.point[1]} r={Math.min(6,.8+d)} fill="#329ac1" opacity=".4" pointerEvents="none"><title>{n.id} 水深 {d.toFixed(2)} m</title></circle>:null;})}
        {campus.zones.map(z=><g key={z.id} transform={`translate(${z.center[0]} ${z.center[1]})`} className={styles.zoneMapLabel} pointerEvents="none"><rect x="-10" y="-6" width="20" height="12" rx="6" fill={z.id===zone?'#3166ff':'#fffffff0'} stroke={z.id===zone?'#3166ff':'#becbbb'} strokeWidth=".6"/><text y="2.6" textAnchor="middle" fill={z.id===zone?'white':'#4c6151'} fontSize="7" fontWeight="600">Z{String(z.id).padStart(2,'0')}</text></g>)}
      </g>
    </svg>
    <div className={styles.north}><span>↑</span>N</div>
    <ViewportControls zoom={controls.camera.zoom} onZoom={f=>{controls.zoomBy(f);controls.focus();}} onReset={controls.reset} onAll={()=>{onViewAll();controls.reset();}}/>
  </div>;
}
