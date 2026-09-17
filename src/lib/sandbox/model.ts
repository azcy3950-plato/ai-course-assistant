import { parseInp } from '@/lib/inp-parser';
import { Campus, FACILITIES, Facility, Patch, Placement, Point, Surface, SURFACE_NAMES } from './types';

export function section(text: string, name: string): string[][] {
  const match = text.match(new RegExp('\\[' + name + '\\]([^]*?)(?=\\n\\s*\\[|$)', 'i'));
  return (match?.[1] || '').split(/\r?\n/).map(s => s.split(';')[0].trim()).filter(Boolean).map(s => s.split(/\s+/));
}
export function replaceSection(text: string, name: string, rows: string[][]): string {
  const re = new RegExp('\\[' + name + '\\][^]*?(?=\\n\\s*\\[|$)', 'i');
  const value = '[' + name + ']\n' + rows.map(r => r.join('\t')).join('\n') + '\n';
  return re.test(text) ? text.replace(re, () => value) : text + '\n' + value;
}
const CONCEPT: Record<string, Facility> = { '绿色屋顶': 'GR', '植草沟': 'VS', '雨水花园': 'RG', '透水砖铺装': 'PP', '透水沥青铺装': 'PP' };
export function buildCampus(text: string): Campus {
  const inp = parseInp(text); const usage = section(text, 'LID_USAGE');
  const land = new Map(section(text, 'COVERAGES').filter(p => Number(p[2]) >= 99).map(p => [p[0], p[1]]));
  const perSub = new Map<string, string[]>();
  for (const row of usage) perSub.set(row[0], [...(perSub.get(row[0]) || []), row[1]]);
  // The large non-C catchment is kept in SWMM as an upstream boundary, not as campus land.
  const patches: Patch[] = inp.scs.filter(s => /^C\d/.test(s.id)).map(s => {
    const names = perSub.get(s.id) || []; let surface: Surface = 'reserved'; let evidence = '尚无空间分类，保留不可编辑';
    if (land.get(s.id) === 'roof' || names.includes('绿色屋顶')) surface = 'roof';
    else if (land.get(s.id) === 'road' || names.some(n => n.includes('铺装'))) surface = 'road';
    else if (land.get(s.id) === 'greenland' || names.some(n => /花园|绿地|植草|花坛|渗渠/.test(n))) surface = 'green';
    if (surface !== 'reserved') evidence = land.has(s.id) ? '来自 INP 土地覆盖标注' : '由案例已有设施识别，教学空间分类';
    const center: Point = [s.pts.reduce((v,p) => v+p[0],0)/s.pts.length, s.pts.reduce((v,p) => v+p[1],0)/s.pts.length];
    return { id: s.id, zone: 0, surface, evidence, area: s.area*10000, points:s.pts, center, imperv:s.imperv, outlet:s.outlet };
  });
  const coords = patches.flatMap(p => p.points);
  const bounds: Campus['bounds'] = [Math.min(...coords.map(p=>p[0])),Math.min(...coords.map(p=>p[1])),Math.max(...coords.map(p=>p[0])),Math.max(...coords.map(p=>p[1]))];
  // Five geographic bands, each split west/east. Deterministic, exhaustive and non-overlapping.
  const sorted = [...patches].sort((a,b)=>a.center[1]-b.center[1] || a.id.localeCompare(b.id));
  for(let row=0;row<5;row++) {
    const band=sorted.slice(Math.floor(row*sorted.length/5), Math.floor((row+1)*sorted.length/5)).sort((a,b)=>a.center[0]-b.center[0]);
    band.forEach((p,i)=>{p.zone=row*2+(i<band.length/2?1:2);});
  }
  const names=['西北组团','东北组团','西侧庭院','东侧庭院','中央西区','中央东区','西南庭院','东南庭院','南侧西区','南侧东区'];
  const zones=Array.from({length:10},(_,i)=>{
    const ps=patches.filter(p=>p.zone===i+1); const area=ps.reduce((a,p)=>a+p.area,0);
    return {id:i+1,name:names[i], area,center:[ps.reduce((a,p)=>a+p.center[0]*p.area,0)/area,ps.reduce((a,p)=>a+p.center[1]*p.area,0)/area] as Point,
      capacities:Object.fromEntries(['roof','road','green','reserved'].map(t=>[t,ps.filter(p=>p.surface===t).reduce((a,p)=>a+p.area,0)])) as Record<Surface,number>};
  });
  const baseline: Placement[]=[];
  for(const [i,row] of usage.entries()) {
    const f=CONCEPT[row[1]], patch=patches.find(p=>p.id===row[0]);
    if(f && patch && FACILITIES[f].surface===patch.surface) {
      const occupied=baseline.filter(p=>p.patchId===patch.id).reduce((s,p)=>s+p.area,0);
      const area=Math.min(Number(row[2])*Number(row[3]),Math.max(0,patch.area-occupied));
      if(area>.01) baseline.push({id:'existing-'+i,patchId:patch.id,facility:f,area,depth:FACILITIES[f].depth,trees:f==='RG'});
    }
  }
  return {version:'zijing-student-v1',patches,zones,baseline,bounds,
    pipes:inp.pipes.map(p=>({id:p.id,points:[[inp.nodes.find(n=>n.id===p.from)?.x||0,inp.nodes.find(n=>n.id===p.from)?.z||0],...p.verts,[inp.nodes.find(n=>n.id===p.to)?.x||0,inp.nodes.find(n=>n.id===p.to)?.z||0]]})),
    nodes:inp.nodes.map(n=>({id:n.id,point:[n.x,n.z],outfall:n.type==='outfall'}))};
}
export function validatePlacements(campus: Campus, raw: unknown): { placements: Placement[]; errors: string[] } {
  if(!Array.isArray(raw) || raw.length>2000) return {placements:[],errors:['设施清单格式错误或超过 2000 条。']};
  const errors:string[]=[], placements:Placement[]=[], occupied=new Map<string,number>(), ids=new Set<string>();
  for(const p of raw) {
    if(!p || typeof p.id!=='string' || p.id.length>100 || ids.has(p.id)) {errors.push('设施编号无效或重复。');continue;}
    ids.add(p.id); const patch=campus.patches.find(x=>x.id===p.patchId); const f=FACILITIES[p.facility as Facility];
    if(!patch || !f) {errors.push('设施或空间不存在。');continue;}
    if(patch.surface!==f.surface) {errors.push(`${patch.id} 是${SURFACE_NAMES[patch.surface]}，不能放置${f.name}。`);continue;}
    if(typeof p.area!=='number' || !Number.isFinite(p.area) || p.area<=0 || typeof p.depth!=='number' || !Number.isFinite(p.depth) || p.depth<20 || p.depth>300) {errors.push('面积须大于 0，蓄水深度须在 20–300 mm 之间。');continue;}
    const area=(occupied.get(patch.id)||0)+p.area; occupied.set(patch.id,area);
    if(area>patch.area+.001) {errors.push(`${patch.id} 已超过可用面积，设施不能重复占地。`);continue;}
    placements.push({id:p.id,patchId:patch.id,facility:p.facility,area:p.area,depth:p.depth,trees:p.facility==='RG' && p.trees===true});
  }
  return {placements,errors};
}
export function planSignature(placements: Placement[], rain: string): string {
  const canonical=JSON.stringify([rain,placements.map(p=>[p.patchId,p.facility,p.area,p.depth,p.trees]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
  let hash=2166136261; for(let i=0;i<canonical.length;i++){hash^=canonical.charCodeAt(i);hash=Math.imul(hash,16777619);} return (hash>>>0).toString(16);
}
