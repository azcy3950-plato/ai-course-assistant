import { describe, expect, it } from 'vitest';
import { artworkCoverage, artworkFilename, createArtworkRecipe, ARTWORK_FACILITIES } from '@/lib/sandbox/artwork';
import type { Campus, Placement } from '@/lib/sandbox/types';

const campus: Campus = {
  version: 'test', bounds: [0, 0, 20, 20], zones: [], baseline: [], pipes: [], nodes: [],
  patches: [
    { id: 'roof', zone: 1, surface: 'roof', evidence: '', area: 1000, points: [], center: [0, 0], imperv: 1, outlet: '' },
    { id: 'green', zone: 5, surface: 'green', evidence: '', area: 2000, points: [], center: [0, 0], imperv: 0, outlet: '' },
    { id: 'road', zone: 2, surface: 'road', evidence: '', area: 1000, points: [], center: [0, 0], imperv: 1, outlet: '' },
    { id: 'reserved', zone: 3, surface: 'reserved', evidence: '', area: 10000, points: [], center: [0, 0], imperv: 0, outlet: '' },
  ],
};
const p = (id: string, area: number, depth = 100, trees = false): Placement => ({ id, patchId: 'green', facility: 'RG', area, depth, trees });

describe('saved plan artwork recipes', () => {
  it('keeps equivalent placement order deterministic and does not mutate the saved configuration', () => {
    const placements = [p('a', 50, 80, true), p('b', 150, 160)];
    const before = structuredClone(placements);
    const result = createArtworkRecipe(campus, placements, '5A');
    expect(result).toEqual(createArtworkRecipe(campus, [...placements].reverse(), '5A'));
    expect(placements).toEqual(before);
    expect(result.facilities.RG).toEqual({ area: 200, depth: 140, treeArea: 50 });
    expect(result.capacities.green).toBe(2000);
    expect(result.capacities).toEqual({ roof: 1000, green: 2000, road: 1000 });
  });
  it('leaves an empty plan on the approved base and keeps coverage bounded and increasing', () => {
    const empty = createArtworkRecipe(campus, [], '5A');
    for (const f of ARTWORK_FACILITIES) expect(artworkCoverage(empty, f)).toBe(0);
    const small = createArtworkRecipe(campus, [p('a', 50)], '5A');
    const larger = createArtworkRecipe(campus, [p('a', 500)], '5A');
    expect(artworkCoverage(small, 'RG')).toBeGreaterThan(0);
    expect(artworkCoverage(larger, 'RG')).toBeGreaterThan(artworkCoverage(small, 'RG'));
    expect(artworkCoverage(createArtworkRecipe(campus, [p('a', 2000)], '5A'), 'RG')).toBe(1);
    expect(artworkCoverage(larger, 'GR')).toBe(0);
  });
  it('tracks depth and tree settings in the snapshot without changing physical area', () => {
    const original = createArtworkRecipe(campus, [p('a', 200, 100, false)], '5A');
    const changed = createArtworkRecipe(campus, [p('a', 200, 180, true)], '5A');
    expect(changed.facilities.RG.area).toBe(original.facilities.RG.area);
    expect(changed.facilities.RG.depth).toBe(180);
    expect(changed.facilities.RG.treeArea).toBe(200);
    expect(changed.signature).not.toBe(original.signature);
  });
  it('makes a portable download filename', () => {
    expect(artworkFilename('CON / 草地:方案?')).toMatch(/^zijing-/);
    expect(artworkFilename('CON / 草地:方案?')).not.toMatch(/[\\/:*?"<>|]/);
    expect(artworkFilename('')).toBe('zijing-plan.png');
  });
});
