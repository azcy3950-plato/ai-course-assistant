export type Facility = 'GR' | 'VS' | 'RG' | 'PP';
export type Surface = 'roof' | 'road' | 'green' | 'reserved';
export type Point = [number, number];
export interface Patch {
  id: string; zone: number; surface: Surface; evidence: string;
  area: number; points: Point[]; center: Point; imperv: number; outlet: string;
}
export interface Zone { id: number; name: string; center: Point; area: number; capacities: Record<Surface, number>; }
export interface Placement { id: string; patchId: string; facility: Facility; area: number; depth: number; trees: boolean; }
export interface Campus {
  version: string; zones: Zone[]; patches: Patch[]; baseline: Placement[];
  bounds: [number, number, number, number];
  pipes: { id: string; points: Point[] }[];
  nodes: { id: string; point: Point; outfall: boolean }[];
}
export const SURFACE_NAMES: Record<Surface, string> = { roof: '屋顶', road: '道路铺装', green: '绿地', reserved: '保留空间' };
export const FACILITIES: Record<Facility, { name: string; english: string; color: string; surface: Surface; description: string; depth: number; cost: number; maintenance: number; embodied: number; annualEmission: number }> = {
  GR: { name: '绿色屋顶', english: 'GREEN ROOF', color: '#497e5b', surface: 'roof', description: '让屋顶留住雨水，增加植被与蒸散。', depth: 100, cost: 260, maintenance: 8, embodied: 24, annualEmission: .25 },
  VS: { name: '植草沟', english: 'VEGETATED SWALE', color: '#96a951', surface: 'green', description: '沿绿地缓慢导流，促进雨水下渗。', depth: 100, cost: 100, maintenance: 3, embodied: 8, annualEmission: .12 },
  RG: { name: '雨水花园', english: 'RAIN GARDEN', color: '#b28cbe', surface: 'green', description: '用下凹花园滞蓄雨水，提供多种生态服务。', depth: 100, cost: 220, maintenance: 6, embodied: 15, annualEmission: .2 },
  PP: { name: '透水铺装', english: 'PERMEABLE PAVING', color: '#bda477', surface: 'road', description: '让步道和道路透水，减轻排水压力。', depth: 65, cost: 180, maintenance: 4, embodied: 42, annualEmission: .3 },
};
export interface HydroResult {
  /** Original engine run directory ID, retained when a result is cached. */
  runId?: string;
  source: 'SWMM'; engine: string; times: number[]; runoff: number[]; outflow: number[];
  runoffVolume: number; peakFlow: number; floodVolume: number; maxDepth: number;
  continuity: { runoff: number; routing: number; quality: number };
  pollutants: Record<string, { concentration: number[]; load: number; loadRate: number[] }>;
  zoneRunoff: Record<string, number>; nodeDepth: Record<string, number[]>;
}
export interface EcoResult {
  annual: { carbon: number; cooling: number; air: number; noise: number; total: number };
  physical: { carbonKg: number; evaporationM3: number; electricityKwh: number; so2Kg: number; dustKg: number; noiseLength: number };
  construction: number; maintenance: number; lifecycleCost: number; lifecycleValue: number;
  embodiedKg: number; area: number; byFacility: Record<Facility, number>;
}
export interface RunResult { id: string; signature: string; baseline: HydroResult; proposed: HydroResult; eco: EcoResult; baselineEco: EcoResult; warnings: string[]; }
