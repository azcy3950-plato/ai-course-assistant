import { describe, expect, it } from 'vitest';
import { Campus, Placement } from '@/lib/sandbox/types';
import { groupPlacements, groupSpaces, setGroupArea, spaceId } from '@/lib/sandbox/grouping';

const campus: Campus = {
  version: 'test',
  bounds: [0, 0, 30, 20],
  zones: [{ id: 1, name: '测试片区', center: [15, 10], area: 600, capacities: { roof: 250, road: 150, green: 200, reserved: 0 } }],
  patches: [
    { id: 'roof-a', zone: 1, surface: 'roof', evidence: '', area: 100, points: [[0, 0], [10, 0], [10, 10], [0, 10]], center: [5, 5], imperv: 1, outlet: 'O1' },
    { id: 'roof-b', zone: 1, surface: 'roof', evidence: '', area: 150, points: [[10, 0], [25, 0], [25, 10], [10, 10]], center: [17.5, 5], imperv: 1, outlet: 'O1' },
    { id: 'green-a', zone: 1, surface: 'green', evidence: '', area: 200, points: [[0, 10], [20, 10], [20, 20], [0, 20]], center: [10, 15], imperv: 0, outlet: 'O1' },
  ],
  baseline: [], pipes: [], nodes: [],
};

describe('sandbox grouped spaces', () => {
  it('merges model patches by zone and surface while retaining reserved geometry', () => {
    const spaces = groupSpaces(campus);
    expect(spaces.find(s => s.id === spaceId(1, 'roof'))?.area).toBe(250);
    expect(spaces.find(s => s.id === spaceId(1, 'roof'))?.patches).toHaveLength(2);
    expect(spaces.find(s => s.id === spaceId(1, 'green'))?.area).toBe(200);
  });

  it('aggregates legacy patch placements for editing without changing eco input', () => {
    const placements: Placement[] = [
      { id: 'a', patchId: 'roof-a', facility: 'GR', area: 20, depth: 100, trees: false },
      { id: 'b', patchId: 'roof-b', facility: 'GR', area: 30, depth: 100, trees: false },
      { id: 'c', patchId: 'green-a', facility: 'RG', area: 10, depth: 100, trees: true },
    ];
    const groups = groupPlacements(campus, placements);
    expect(groups.find(g => g.spaceId === spaceId(1, 'roof'))?.area).toBe(50);
    expect(groups).toHaveLength(2);
  });

  it('sets a group total across patches, keeps other facilities, and enforces capacity', () => {
    const original: Placement[] = [{ id: 'vs', patchId: 'green-a', facility: 'VS', area: 40, depth: 100, trees: false }];
    const next = setGroupArea(campus, original, groupSpaces(campus).find(s => s.id === spaceId(1, 'green'))!, { facility: 'RG', depth: 100, trees: true }, 80);
    expect(next.filter(p => p.facility === 'RG').reduce((s, p) => s + p.area, 0)).toBeCloseTo(80);
    expect(next.find(p => p.facility === 'VS')?.area).toBe(40);
    expect(() => setGroupArea(campus, next, groupSpaces(campus).find(s => s.id === spaceId(1, 'green'))!, { facility: 'RG', depth: 100, trees: true }, 170)).toThrow(/可分配/);
  });
});
