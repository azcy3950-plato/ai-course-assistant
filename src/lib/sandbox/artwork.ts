import { planSignature } from './model';
import { FACILITIES, type Campus, type Facility, type Placement, type Point } from './types';

export const ARTWORK_VERSION = 'zijing-plan-artwork-v2' as const;
export const LEGACY_ARTWORK_VERSION = 'zijing-plan-artwork-v1' as const;
export const ARTWORK_FACILITIES: Facility[] = ['GR', 'VS', 'RG', 'PP'];
export const ARTWORK_NOTE = '按教学片区显示设施；景观位置为示意，面积及计算采用实际模型。';

export interface ArtworkFacilitySummary {
  area: number;
  depth: number;
  treeArea: number;
}
export interface ArtworkZoneSummary {
  facilities: Record<Facility, ArtworkFacilitySummary>;
  capacities: { roof: number; road: number; green: number };
}
export interface ArtworkRecipe {
  version: typeof ARTWORK_VERSION | typeof LEGACY_ARTWORK_VERSION;
  modelVersion: string;
  signature: string;
  facilities: Record<Facility, ArtworkFacilitySummary>;
  capacities: { roof: number; road: number; green: number };
  zones?: Record<string, ArtworkZoneSummary>;
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

/** Snapshot both totals and per-zone configuration without changing model placements. */
export function createArtworkRecipe(campus: Campus, placements: Placement[], rain: string): ArtworkRecipe {
  const emptyFacilities = () => Object.fromEntries(ARTWORK_FACILITIES.map(f => [f, { area: 0, depth: 0, treeArea: 0 }])) as Record<Facility, ArtworkFacilitySummary>;
  const facilities = emptyFacilities();
  const capacities = { roof: 0, road: 0, green: 0 };
  const zones: Record<string, ArtworkZoneSummary> = {};
  for (const patch of campus.patches) {
    const zone = zones[patch.zone] ||= { facilities: emptyFacilities(), capacities: { roof: 0, road: 0, green: 0 } };
    if (patch.surface !== 'reserved' && Number.isFinite(patch.area) && patch.area > 0) {
      capacities[patch.surface] += patch.area;
      zone.capacities[patch.surface] += patch.area;
    }
  }
  const patches = new Map(campus.patches.map(p => [p.id, p]));
  const ordered = [...placements].sort((a, b) => `${a.patchId}|${a.facility}|${a.area}|${a.depth}|${a.trees}`.localeCompare(`${b.patchId}|${b.facility}|${b.area}|${b.depth}|${b.trees}`));
  for (const p of ordered) {
    const patch = patches.get(p.patchId);
    if (!patch || !FACILITIES[p.facility] || patch.surface !== FACILITIES[p.facility].surface || !Number.isFinite(p.area) || p.area <= 0 || !Number.isFinite(p.depth)) continue;
    for (const summary of [facilities[p.facility], zones[patch.zone].facilities[p.facility]]) {
      summary.area += p.area;
      summary.depth += p.area * p.depth;
      if (p.facility === 'RG' && p.trees) summary.treeArea += p.area;
    }
  }
  for (const row of [facilities, ...Object.values(zones).map(zone=>zone.facilities)]) {
    for (const f of ARTWORK_FACILITIES) {
      const s = row[f];
      s.depth = s.area > 0 ? s.depth / s.area : 0;
    }
  }
  return { version: ARTWORK_VERSION, modelVersion: campus.version, signature: planSignature(placements, rain), facilities, capacities, zones };
}

/** A minimum visual footprint keeps small classroom experiments visible; it is not a scale drawing. */
export function artworkCoverage(recipe: ArtworkRecipe, facility: Facility, zoneId?: number): number {
  const summary = zoneId === undefined ? recipe : recipe.zones?.[zoneId];
  if (!summary) return 0;
  const area = summary.facilities[facility].area;
  const capacity = summary.capacities[FACILITIES[facility].surface as 'roof' | 'road' | 'green'];
  if (!(area > 0) || !(capacity > 0)) return 0;
  const share = Math.min(1, Math.max(0, area / capacity));
  return 0.08 + 0.92 * Math.sqrt(share);
}

export const artworkNote = (recipe: ArtworkRecipe) => recipe.version === LEGACY_ARTWORK_VERSION
  ? '按社区设施总量生成的风格化示意；具体地块位置以编辑地图为准。'
  : ARTWORK_NOTE;

export function artworkFilename(name: string): string {
  const safe = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 60);
  return 'zijing-' + (safe || 'plan') + '.png';
}
