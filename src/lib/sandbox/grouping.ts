import { Campus, FACILITIES, Facility, Patch, Placement, Surface, SURFACE_NAMES } from './types';

export interface SpaceGroup {
  id: string;
  zone: number;
  surface: Surface;
  area: number;
  patches: Patch[];
}
export type FacilityConfig = Pick<Placement, 'facility' | 'depth' | 'trees'>;
export interface GroupedPlacement extends FacilityConfig {
  key: string;
  spaceId: string;
  area: number;
}

export const spaceId = (zone: number, surface: Surface) => `Z${String(zone).padStart(2, '0')}-${surface}`;
export const configKey = (p: FacilityConfig) => `${p.facility}-${p.depth}-${p.facility === 'RG' && p.trees ? 'trees' : 'plain'}`;

// Editing groups do not replace the original SWMM catchments or their geometry.
export function groupSpaces(campus: Campus): SpaceGroup[] {
  return campus.zones.flatMap(zone => (['roof', 'road', 'green', 'reserved'] as Surface[]).flatMap(surface => {
    const patches = campus.patches.filter(p => p.zone === zone.id && p.surface === surface);
    return patches.length ? [{id: spaceId(zone.id, surface), zone: zone.id, surface, patches, area: patches.reduce((s, p) => s + p.area, 0)}] : [];
  }));
}

// Old saved plans are aggregated for display only; reading one never redistributes it.
// Different depth/tree settings remain separate so importing a plan loses no settings.
export function groupPlacements(campus: Campus, placements: Placement[]): GroupedPlacement[] {
  const patches = new Map(campus.patches.map(p => [p.id, p]));
  const groups = new Map<string, GroupedPlacement>();
  for (const p of placements) {
    const patch = patches.get(p.patchId);
    if (!patch) continue;
    const space = spaceId(patch.zone, patch.surface), key = `${space}:${configKey(p)}`;
    const group = groups.get(key);
    if (group) group.area += p.area;
    else groups.set(key, {key, spaceId: space, facility: p.facility, depth: p.depth, trees: p.facility === 'RG' && p.trees, area: p.area});
  }
  return [...groups.values()];
}

/** Apply one total to a zone/surface/config, distributing by remaining patch capacity.
 * Other facilities, surfaces and zones retain their exact placements and IDs.
 * The returned patch-level plan uses the existing validation, save and SWMM pipeline.
 */
export function setGroupArea(campus: Campus, placements: Placement[], space: SpaceGroup, config: FacilityConfig, total: number): Placement[] {
  const facility = FACILITIES[config.facility as Facility];
  if (!facility || facility.surface !== space.surface) throw new Error(`${SURFACE_NAMES[space.surface]}不能布置${facility?.name || '此设施'}。`);
  if (!Number.isFinite(total) || total < 0) throw new Error('合计面积必须是大于或等于 0 的数字。');
  if (!Number.isFinite(config.depth) || config.depth < 20 || config.depth > 300) throw new Error('蓄水深度须在 20–300 mm 之间。');
  const patchIds = new Set(space.patches.map(p => p.id));
  const key = configKey(config);
  const matches = (p: Placement) => patchIds.has(p.patchId) && configKey(p) === key;
  const existing = placements.filter(matches);
  if (Math.abs(existing.reduce((s, p) => s + p.area, 0) - total) < 1e-9) return placements;
  const other = placements.filter(p => !matches(p));
  if (total === 0) return other;
  const occupied = new Map<string, number>();
  for (const p of other) occupied.set(p.patchId, (occupied.get(p.patchId) || 0) + p.area);
  // Resolve capacities from the campus model, never from a draft control value.
  const capacities = campus.patches.filter(p => p.zone === space.zone && p.surface === space.surface)
    .map(p => ({patch: p, free: Math.max(0, p.area - (occupied.get(p.id) || 0))})).filter(p => p.free > 0);
  let remainingCapacity = capacities.reduce((s, p) => s + p.free, 0);
  if (total > remainingCapacity + 1e-7) throw new Error(`本片区${SURFACE_NAMES[space.surface]}可分配给此项的面积为 ${remainingCapacity.toFixed(2)} m²，请减少面积。`);
  let remaining = Math.min(total, remainingCapacity);
  const oldIds = new Map(existing.map(p => [p.patchId, p.id]));
  const distributed: Placement[] = [];
  for (const {patch, free} of capacities) {
    const area = Math.min(free, remaining, remaining * (free / remainingCapacity));
    if (area > 0) distributed.push({id: oldIds.get(patch.id) || crypto.randomUUID(), patchId: patch.id, facility: config.facility, depth: config.depth, trees: config.facility === 'RG' && config.trees, area});
    remaining -= area;
    remainingCapacity -= free;
  }
  return [...other, ...distributed];
}
