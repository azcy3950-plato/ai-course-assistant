import { planSignature } from './model';
import { FACILITIES, type Campus, type Facility, type Placement, type Point } from './types';

export const ARTWORK_VERSION = 'zijing-plan-artwork-v1' as const;
export const ARTWORK_FACILITIES: Facility[] = ['GR', 'VS', 'RG', 'PP'];
export const ARTWORK_NOTE = '按社区设施总量生成的风格化示意；具体地块位置以编辑地图为准。';

export interface ArtworkFacilitySummary {
  area: number;
  depth: number;
  treeArea: number;
}
export interface ArtworkRecipe {
  version: typeof ARTWORK_VERSION;
  modelVersion: string;
  signature: string;
  facilities: Record<Facility, ArtworkFacilitySummary>;
  capacities: { roof: number; road: number; green: number };
}
export interface ArtworkRegion {
  id: string;
  polygon?: Point[];
  rect?: [number, number, number, number];
  rotation?: number;
  route?: Point[];
  width?: number;
  clipPolygon?: Point[];
}
export interface ArtworkLayout {
  canvas: { width: number; height: number };
  base: string;
  assets: Record<Facility, { src: string; sourceRect: [number, number, number, number] }>;
  layers: Record<Facility, { label: string; regions: ArtworkRegion[] }>;
  drawOrder: Facility[];
  groundForegroundMasks: { id: string; ellipse: [number, number, number, number] }[];
}

/** The drawing expresses campus totals in approved visual slots, not surveyed patch footprints. */
export function createArtworkRecipe(campus: Campus, placements: Placement[], rain: string): ArtworkRecipe {
  const facilities = Object.fromEntries(ARTWORK_FACILITIES.map(f => [f, { area: 0, depth: 0, treeArea: 0 }])) as Record<Facility, ArtworkFacilitySummary>;
  const patches = new Map(campus.patches.map(p => [p.id, p]));
  const ordered = [...placements].sort((a, b) => `${a.patchId}|${a.facility}|${a.area}|${a.depth}|${a.trees}`.localeCompare(`${b.patchId}|${b.facility}|${b.area}|${b.depth}|${b.trees}`));
  for (const p of ordered) {
    const patch = patches.get(p.patchId);
    if (!patch || !FACILITIES[p.facility] || patch.surface !== FACILITIES[p.facility].surface || !Number.isFinite(p.area) || p.area <= 0 || !Number.isFinite(p.depth)) continue;
    const summary = facilities[p.facility];
    summary.area += p.area;
    summary.depth += p.area * p.depth;
    if (p.facility === 'RG' && p.trees) summary.treeArea += p.area;
  }
  for (const f of ARTWORK_FACILITIES) {
    const s = facilities[f];
    s.depth = s.area > 0 ? s.depth / s.area : 0;
  }
  const capacities = { roof: 0, road: 0, green: 0 };
  for (const patch of campus.patches) if (patch.surface !== 'reserved' && Number.isFinite(patch.area) && patch.area > 0) capacities[patch.surface] += patch.area;
  return { version: ARTWORK_VERSION, modelVersion: campus.version, signature: planSignature(placements, rain), facilities, capacities };
}

/** A minimum visual footprint keeps small classroom experiments visible; it is not a scale drawing. */
export function artworkCoverage(recipe: ArtworkRecipe, facility: Facility): number {
  const area = recipe.facilities[facility].area;
  const capacity = recipe.capacities[FACILITIES[facility].surface as 'roof' | 'road' | 'green'];
  if (!(area > 0) || !(capacity > 0)) return 0;
  const share = Math.min(1, Math.max(0, area / capacity));
  return 0.08 + 0.92 * Math.sqrt(share);
}

export function artworkFilename(name: string): string {
  const safe = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 60);
  return 'zijing-' + (safe || 'plan') + '.png';
}
