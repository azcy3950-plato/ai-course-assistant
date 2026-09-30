'use client';
import { useEffect, useId, useMemo, useState, type DragEvent } from 'react';
import type { ArtworkRecipe } from '@/lib/sandbox/artwork';
import layout from '@/lib/sandbox/artwork-layout.json';
import { renderPlanArtwork } from '@/lib/sandbox/artwork-renderer';
import { LANDSCAPE_ZONES, landscapeZone } from '@/lib/sandbox/landscape-layout';
import { groupPlacements, groupSpaces, spaceId, type FacilityConfig, type GroupedPlacement } from '@/lib/sandbox/grouping';
import { FACILITIES, SURFACE_NAMES, type Campus, type Facility, type Placement, type Surface } from '@/lib/sandbox/types';
import { boundsOf, type Bounds } from '@/lib/sandbox/viewport';
import useSvgViewport, { type ViewRequest } from './useSvgViewport';
import ViewportControls from './ViewportControls';
import GroupPlacementEditor from './GroupPlacementEditor';
import styles from './studio.module.css';

const bounds: Bounds = [0, 0, layout.canvas.width, layout.canvas.height];
const KEYS = Object.keys(FACILITIES) as Facility[];
type EditableSurface = Exclude<Surface, 'reserved'>;
type Selection = { zone: number; surface: EditableSurface; facility?: Facility };
type Props = {
  recipe: ArtworkRecipe; campus: Campus; placements: Placement[]; zone: number; selectedSurface?: Surface;
  viewRequest: ViewRequest; disabled: boolean; onViewAll: () => void;
  onSelectZone: (zone: number) => void;
  onSelectSpace: (zone: number, surface: EditableSurface, facility?: Facility) => void;
  onAddFacility: (zone: number, surface: EditableSurface, facility: Facility, area?: number) => void;
  onApplyGroup: (space: string, config: FacilityConfig, area: number) => boolean;
};
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
const points = (polygon: number[][]) => polygon.map(point=>point.join(',')).join(' ');

export default function LandscapeViewport({ recipe, campus, placements, zone, selectedSurface, viewRequest, disabled, onViewAll, onSelectZone, onSelectSpace, onAddFacility, onApplyGroup }: Props) {
  const clipId = useId();
  const targetBounds = useMemo(()=>viewRequest.zone===null?bounds:boundsOf(landscapeZone(viewRequest.zone)?.boundary||[]),[viewRequest.zone]);
  const controls = useSvgViewport({ bounds, targetBounds, request: viewRequest, disabled });
  const [image, setImage] = useState(layout.base), [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [message, setMessage] = useState('');
  const [dropping, setDropping] = useState(false), [selection, setSelection] = useState<Selection|null>(null);
  const spaces = useMemo(()=>groupSpaces(campus),[campus]);
  const groups = useMemo(()=>groupPlacements(campus,placements),[campus,placements]);
  const panel = selection?.zone===zone && selection.surface===selectedSurface ? selection : null;
  const panelSpace = panel && spaces.find(space=>space.id===spaceId(panel.zone,panel.surface));
  const panelGroups = panel ? groups.filter(group=>group.spaceId===spaceId(panel.zone,panel.surface)&&(!panel.facility||group.facility===panel.facility)) : [];
  const used = panelSpace ? placements.filter(p=>panelSpace.patches.some(patch=>patch.id===p.patchId)).reduce((sum,p)=>sum+p.area,0) : 0;
  const free = Math.max(0,(panelSpace?.area||0)-used);
  const quickArea = Math.min(50,Math.floor(free*100)/100);
  useEffect(()=>{if(selection&&(selection.zone!==zone||selection.surface!==selectedSurface))setSelection(null);},[zone,selectedSurface,selection]);
  useEffect(() => () => { if (image.startsWith('blob:')) URL.revokeObjectURL(image); }, [image]);
  useEffect(() => {
    let alive = true;
    setStatus('loading'); setMessage('');
    renderPlanArtwork(recipe).then(canvas => new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('效果图生成失败，请重试。')), 'image/png');
    })).then(blob => {
      if (!alive) return;
      setImage(URL.createObjectURL(blob)); setStatus('ready');
    }).catch(error => {
      if (alive) { setStatus('error'); setMessage(error instanceof Error ? error.message : '效果图加载失败，请重试。'); }
    });
    return () => { alive = false; };
  }, [recipe, attempt]);

  function select(next: Selection) {
    if (disabled) return;
    onSelectSpace(next.zone,next.surface,next.facility); setSelection(next);
  }
  function add(facility: Facility) {
    if (!panel || disabled || quickArea<=0) return;
    onAddFacility(panel.zone,panel.surface,facility,quickArea);
    setSelection({...panel,facility});
  }
  function drop(event: DragEvent<SVGSVGElement>) {
    event.preventDefault(); setDropping(false);
    if (!controls.canDrop()) return;
    const facility = event.dataTransfer.getData('application/x-lid') as Facility;
    if (!FACILITIES[facility]) return;
    const hit = document.elementFromPoint(event.clientX,event.clientY);
    const space = hit?.closest('[data-landscape-space]');
    const region = hit?.closest('[data-landscape-zone]');
    if (!space && !region) return;
    const id = Number(space?.getAttribute('data-zone') || region?.getAttribute('data-landscape-zone') || zone);
    const surface = (space?.getAttribute('data-surface') || FACILITIES[facility].surface) as EditableSurface;
    onAddFacility(id,surface,facility);
    if (surface===FACILITIES[facility].surface) setSelection({zone:id,surface,facility});
  }
  function edit(group: GroupedPlacement, area: number) {
    onApplyGroup(group.spaceId,{facility:group.facility,depth:group.depth,trees:group.trees},area);
  }

  return <div className={styles.mapCanvas+' '+styles.landscapeViewport} data-artwork-state={status} data-artwork-signature={recipe.signature}>
    <svg ref={controls.svg} viewBox={'0 0 '+layout.canvas.width+' '+layout.canvas.height} tabIndex={disabled ? -1 : 0} role="group" aria-label="紫荆雅苑景观交互沙盘" aria-describedby="sandbox-landscape-help" data-testid="sandbox-landscape" data-dragging={controls.dragging} data-space={controls.spaceDown} {...controls.handlers}
      onDragOver={event => { if (controls.canDrop()) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropping(true); } }} onDragLeave={() => setDropping(false)} onDrop={drop}>
      <desc id="sandbox-landscape-help">点击片区标签定位，点击屋顶、道路或绿地选择空间；拖入设施添加到落点所在片区。点击已布置设施标记可调整面积或移除。滚轮缩放，空格加左键平移。景观位置按教学片区示意，面积与计算采用实际模型。</desc>
      <defs>{LANDSCAPE_ZONES.map(region=><clipPath key={region.id} id={clipId+'-'+region.id} clipPathUnits="userSpaceOnUse"><polygon points={points(region.boundary)}/></clipPath>)}</defs>
      <g data-camera="landscape" transform={controls.transform}>
        <image href={image} width={layout.canvas.width} height={layout.canvas.height} pointerEvents="none" data-landscape-image="true" />
        {LANDSCAPE_ZONES.map(region=><g key={region.id} data-landscape-zone={region.id}>
          <polygon data-landscape-zone-boundary={region.id} points={points(region.boundary)} className={styles.landscapeZoneBoundary} data-selected={zone===region.id} onClick={()=>{if(!disabled){setSelection(null);onSelectZone(region.id);}}}/>
          {(['green','road','roof'] as EditableSurface[]).map(surface=><g key={surface} clipPath={'url(#'+clipId+'-'+region.id+')'} data-landscape-space={spaceId(region.id,surface)} data-zone={region.id} data-surface={surface} data-selected={zone===region.id&&selectedSurface===surface} className={styles.landscapeSpace} role="button" tabIndex={disabled?-1:0} aria-label={'选择 Z'+String(region.id).padStart(2,'0')+' 的'+SURFACE_NAMES[surface]} aria-pressed={zone===region.id&&selectedSurface===surface} onClick={()=>select({zone:region.id,surface})} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select({zone:region.id,surface});}}}>
            {region.surfaces[surface].map((polygon,index)=><polygon key={index} points={points(polygon)}><title>{'Z'+String(region.id).padStart(2,'0')+' · '+SURFACE_NAMES[surface]+' · 点击配置'}</title></polygon>)}
          </g>)}
        </g>)}
        {LANDSCAPE_ZONES.map(region=>{
          const totals = recipe.zones?.[region.id]?.facilities;
          return <g key={region.id} data-landscape-zone={region.id}>
            <g data-zone-label={region.id} className={styles.landscapeZoneLabel} transform={'translate('+region.label.join(' ')+')'} role="button" tabIndex={disabled?-1:0} aria-label={'选择景观图上的 Z'+String(region.id).padStart(2,'0')+' 片区'} aria-pressed={zone===region.id} onClick={()=>{if(!disabled){setSelection(null);onSelectZone(region.id);}}} onKeyDown={event=>{if(!disabled&&(event.key==='Enter'||event.key===' ')){event.preventDefault();setSelection(null);onSelectZone(region.id);}}}>
              <rect x="-34" y="-16" width="68" height="32" rx="16"/><text y="6" textAnchor="middle" pointerEvents="none">Z{String(region.id).padStart(2,'0')}</text>
            </g>
            {KEYS.filter(f=>(totals?.[f].area||0)>0).map(f=>{
              const marker=region.markers[f],x=f==='RG'?marker[0]+30:f==='VS'?region.facilities.VS[0].route![0][0]-15:marker[0],y=f==='RG'?marker[1]-10:f==='VS'?region.facilities.VS[0].route![0][1]+5:marker[1];
              return <g key={f} data-landscape-facility={f} data-zone={region.id} data-surface={FACILITIES[f].surface} data-landscape-space={spaceId(region.id,FACILITIES[f].surface)} data-viewport-control="true" data-selected={panel?.zone===region.id&&panel.facility===f} className={styles.landscapeFacility} transform={'translate('+x+' '+y+')'} role="button" tabIndex={disabled?-1:0} aria-label={'编辑 Z'+String(region.id).padStart(2,'0')+' 的'+FACILITIES[f].name} onClick={()=>select({zone:region.id,surface:FACILITIES[f].surface as EditableSurface,facility:f})} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select({zone:region.id,surface:FACILITIES[f].surface as EditableSurface,facility:f});}}}>
                <rect x="-42" y="-14" width="84" height="28" rx="8"/><circle cx="-30" cy="0" r="4" fill={FACILITIES[f].color} pointerEvents="none"/><text x="4" y="5" textAnchor="middle" pointerEvents="none">{f} {number(totals![f].area)}</text><title>{FACILITIES[f].name+' '+number(totals![f].area)+' m² · 点击编辑'}</title>
              </g>;
            })}
          </g>;
        })}
      </g>
    </svg>
    <ViewportControls landscape zoom={controls.camera.zoom} onZoom={factor => { controls.zoomBy(factor); controls.focus(); }} onReset={controls.reset} onAll={() => { setSelection(null); onViewAll(); controls.reset(); }} />
    {panel&&<section className={styles.landscapeSelection} aria-label="景观设施配置" data-testid="landscape-selection">
      <div className={styles.panelHeading}><h3>Z{String(panel.zone).padStart(2,'0')} · {panel.facility?FACILITIES[panel.facility].name:SURFACE_NAMES[panel.surface]}</h3><button aria-label="关闭景观配置" className={styles.panelClose} onClick={()=>setSelection(null)}>×</button></div>
      <p className={styles.hint}>片区{SURFACE_NAMES[panel.surface]}剩余 {number(free)} m²</p>
      <div className={styles.landscapeAddActions}>{KEYS.filter(f=>FACILITIES[f].surface===panel.surface).map(f=><button key={f} disabled={disabled||quickArea<=0} onClick={()=>add(f)}>＋ {FACILITIES[f].name} {number(quickArea)} m²</button>)}</div>
      {panelGroups.length>0?<div className={styles.landscapeEditors}>{panelGroups.map(group=><GroupPlacementEditor key={group.key} item={group} available={free} disabled={disabled} onApply={area=>edit(group,area)} onRemove={()=>edit(group,0)}/>)}</div>:<p className={styles.hint}>点击上方按钮布置设施，也可从工具箱拖到此处。</p>}
    </section>}
    {status === 'loading' && <div className={styles.landscapeStatus} role="status">正在更新景观效果…</div>}
    {status === 'error' && <div className={styles.landscapeStatus} role="alert">{message}<button className={styles.textButton} onClick={() => setAttempt(value => value + 1)}>重新生成</button></div>}
    {dropping && !disabled && <div className={styles.landscapeDrop}>松开，将设施添加到落点所在片区的适用空间</div>}
  </div>;
}
