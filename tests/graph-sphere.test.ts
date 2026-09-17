import { describe, expect, it } from "vitest";
import { sphereLayout } from "../src/lib/graph-sphere";
import { buildAllNetworks } from "../src/lib/knowledge-map-builder";

describe("spherical knowledge graph", () => {
  it("keeps the real graph data unchanged and produces stable finite positions", () => {
    for (const network of buildAllNetworks()) {
      const graph = { nodes: network.nodes, edges: network.edges }, before = JSON.stringify(graph);
      const layout = sphereLayout(graph);
      expect(layout).toEqual(sphereLayout(graph));
      expect(JSON.stringify(graph)).toBe(before);
      expect(new Set(layout.map(n => n.id)).size).toBe(graph.nodes.length);
      for (const n of layout) expect([n.x, n.y, n.z].every(Number.isFinite)).toBe(true);
      expect(new Set(layout.map(n => n.z)).size).toBeGreaterThan(2);
      for (let i = 0; i < layout.length; i++) for (let j = i + 1; j < layout.length; j++) {
        const a = layout[i], b = layout[j];
        expect(Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z)).toBeGreaterThan(12);
      }
    }
  });
  it("keeps chapter groups separated in the combined graph", () => {
    const networks = buildAllNetworks(), graph = { nodes: networks.flatMap(n => n.nodes), edges: networks.flatMap(n => n.edges) };
    const layout = sphereLayout(graph), roots = layout.filter(n => n.depth === 0);
    expect(roots).toHaveLength(networks.length);
    for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) {
      const a = roots[i], b = roots[j];
      expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeGreaterThan(250);
    }
  });
  it("handles empty, disconnected and cyclic input", () => {
    expect(sphereLayout({ nodes: [], edges: [] })).toEqual([]);
    const nodes = buildAllNetworks()[0].nodes.slice(0, 3);
    const edges = nodes.map((n, i) => ({ id: String(i), source: n.id, target: nodes[(i+1)%nodes.length].id, relation: "related" as const, label: "" }));
    expect(sphereLayout({ nodes, edges })).toHaveLength(3);
    expect(sphereLayout({ nodes, edges: [] })).toHaveLength(3);
  });
});
