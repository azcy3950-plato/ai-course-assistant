import type { Campus, Facility, HydroResult, Placement, RunResult } from '@/lib/sandbox/types';
import { FACILITIES } from '@/lib/sandbox/types';
import { configKey, groupPlacements, groupSpaces, setGroupArea } from '@/lib/sandbox/grouping';
import { planSignature } from '@/lib/sandbox/model';

export const EXPERIMENT_STORAGE_PREFIX = 'wenshui-experiments-v1';
export type ExperimentLessonId = 'rain-garden' | 'permeable-paving';
export type ExperimentPreset = {
  lessonId: ExperimentLessonId; title: string; facility: 'RG' | 'PP';
  area: number; depth: number; trees: boolean; rain: string; question: string;
};
export const EXPERIMENT_PRESETS: Record<ExperimentLessonId, ExperimentPreset> = {
  'rain-garden': {lessonId:'rain-garden', title:'给雨水留一块花园', facility:'RG', area:50, depth:100, trees:false, rain:'5A', question:'增加雨水花园后，径流总量和出流峰值是否同样变化？哪些条件限制了它的作用？'},
  'permeable-paving': {lessonId:'permeable-paving', title:'让道路多一条雨水去路', facility:'PP', area:50, depth:100, trees:false, rain:'5A', question:'透水铺装改变了径流总量还是出流过程？下一轮只调整面积，你预计结果会怎样？'},
};
export function getExperimentPreset(id: unknown): ExperimentPreset | null {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(EXPERIMENT_PRESETS, id)
    ? EXPERIMENT_PRESETS[id as ExperimentLessonId] : null;
}

/** Add to the chosen zone, preserving every unrelated draft placement. */
export function planMentorSuggestion(campus: Campus, placements: Placement[], zone: number, preset: ExperimentPreset) {
  const space = groupSpaces(campus).find(item => item.zone === zone && item.surface === FACILITIES[preset.facility].surface);
  if (!space) throw new Error(`当前片区没有适合${FACILITIES[preset.facility].name}的空间，请先选择其他片区。`);
  const patchIds = new Set(space.patches.map(patch => patch.id));
  const used = placements.filter(item => patchIds.has(item.patchId)).reduce((sum, item) => sum + item.area, 0);
  if (space.area - used < preset.area - 1e-7) throw new Error(`当前片区的适用空间不足 ${preset.area} m²，请先选择其他片区或调整配置。`);
  const config = {facility:preset.facility, depth:preset.depth, trees:preset.trees};
  const previous = groupPlacements(campus, placements).find(item => item.spaceId === space.id && configKey(item) === configKey(config))?.area || 0;
  return {placements:setGroupArea(campus, placements, space, config, previous + preset.area), patchId:space.patches[0].id};
}

export type ExperimentMetrics = Pick<HydroResult, 'runoffVolume' | 'peakFlow' | 'floodVolume' | 'maxDepth'>;
export type MentorExperimentRecord = {
  id: string; resultId: string; lessonId: ExperimentLessonId; signature: string; rain: string;
  createdAt: string; facility: Facility; facilityArea: number; totalArea: number;
  baseline: ExperimentMetrics; proposed: ExperimentMetrics; reflection: string; stale: boolean; engine: string;
};
export type ExperimentNotebook = {version:1; records:MentorExperimentRecord[]};
const METRICS = ['runoffVolume', 'peakFlow', 'floodVolume', 'maxDepth'] as const;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function readMetrics(value: unknown): ExperimentMetrics | null {
  if (!isObject(value) || !METRICS.every(key => finite(value[key]))) return null;
  return Object.fromEntries(METRICS.map(key => [key, value[key]])) as ExperimentMetrics;
}
export function restoreExperimentNotebook(value: unknown): ExperimentNotebook {
  const records: MentorExperimentRecord[] = [];
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.records)) return {version:1, records};
  const seen = new Set<string>();
  for (const raw of value.records) {
    if (!isObject(raw)) continue;
    const preset = getExperimentPreset(raw.lessonId), baseline = readMetrics(raw.baseline), proposed = readMetrics(raw.proposed);
    if (!preset || !baseline || !proposed || typeof raw.id !== 'string' || !raw.id || raw.id.length > 250 || seen.has(raw.id)
      || typeof raw.resultId !== 'string' || !raw.resultId || typeof raw.signature !== 'string' || !raw.signature
      || !['3A','5A','10A','20A','50A'].includes(String(raw.rain)) || !finite(raw.facilityArea) || !finite(raw.totalArea)
      || raw.facilityArea > raw.totalArea + 1e-5 || typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))) continue;
    seen.add(raw.id);
    records.push({id:raw.id, resultId:raw.resultId.slice(0,200), lessonId:preset.lessonId, signature:raw.signature.slice(0,100), rain:String(raw.rain),
      createdAt:raw.createdAt, facility:preset.facility, facilityArea:raw.facilityArea, totalArea:raw.totalArea, baseline, proposed,
      reflection:typeof raw.reflection === 'string' ? raw.reflection.slice(0,2000) : '', stale:raw.stale === true,
      engine:typeof raw.engine === 'string' ? raw.engine.slice(0,100) : 'SWMM'});
  }
  return {version:1, records:records.sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0,20)};
}
export function upsertExperimentRecord(notebook: ExperimentNotebook, record: MentorExperimentRecord): ExperimentNotebook {
  return restoreExperimentNotebook({version:1, records:[record, ...notebook.records.filter(item => item.id !== record.id)]});
}
/** A result can only be associated with the plan that the engine actually ran. */
export function makeExperimentRecord(lessonId: ExperimentLessonId, result: RunResult, placements: Placement[], rain: string, now = new Date().toISOString()): MentorExperimentRecord | null {
  const preset = getExperimentPreset(lessonId);
  if (!preset || result.signature !== planSignature(placements,rain) || result.baseline.source !== 'SWMM' || result.proposed.source !== 'SWMM') return null;
  const baseline = readMetrics(result.baseline), proposed = readMetrics(result.proposed);
  const facilityArea = placements.filter(item => item.facility === preset.facility).reduce((sum,item) => sum + item.area,0);
  if (!baseline || !proposed || facilityArea <= 0) return null;
  const record = {id:`${lessonId}:${result.id}`, resultId:result.id, lessonId, signature:result.signature, rain, createdAt:now, facility:preset.facility,
    facilityArea, totalArea:placements.reduce((sum,item) => sum + item.area,0), baseline, proposed, reflection:'', stale:false, engine:result.proposed.engine};
  return restoreExperimentNotebook({version:1,records:[record]}).records[0] || null;
}
export function reductionPercent(baseline: number, proposed: number): number | null {
  return Number.isFinite(baseline) && Number.isFinite(proposed) && baseline > 1e-9 ? (baseline-proposed)/baseline*100 : null;
}
export function experimentObservation(record: MentorExperimentRecord): string {
  const describe = (label:string, a:number, b:number) => {
    const value = reductionPercent(a,b);
    if (value === null) return `${label}基准为零，不计算削减率`;
    if (Math.abs(value) < .05) return `${label}变化小于 0.05%`;
    return `${label}${value > 0 ? '降低' : '增加'}了 ${Math.abs(value).toFixed(1)}%`;
  };
  return `${describe('径流总量',record.baseline.runoffVolume,record.proposed.runoffVolume)}；${describe('出流峰值',record.baseline.peakFlow,record.proposed.peakFlow)}。这是当前整个方案与课程基准的比较，不能把差异全部归因于新加的设施。`;
}
