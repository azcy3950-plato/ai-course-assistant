import { describe, expect, it } from "vitest";
import { buildAllNetworks } from "../src/lib/knowledge-map-builder";
import {
  emptySession,
  neighborhood,
  relationExplanation,
  restoreSession,
  stableLayout,
} from "../src/components/guided/model";
import {
  gradePractice,
  PRACTICES,
  reachableNodes,
} from "../src/components/guided/learning-content";

const built = buildAllNetworks().find((n) => n.def.id === "water")!;
const graph = { nodes: built.nodes, edges: built.edges };
describe("guided learning interactions", () => {
  it("expands exactly the requested number of hops", () => {
    const leaf = graph.nodes.find((n) => n.name === "消毒")!;
    const parent = graph.edges.find((e) => e.target === leaf.id)!.source;
    const one = neighborhood(graph, [leaf.id], 1);
    expect(one).toEqual(new Set([leaf.id, parent]));
    const two = neighborhood(graph, [leaf.id], 2);
    expect(two.has(graph.nodes.find((n) => n.name === "混凝")!.id)).toBe(true);
    expect(two.has(graph.nodes.find((n) => n.name === "地下水")!.id)).toBe(
      false,
    );
  });
  it("preserves coordinates across graph copies and distinguishes containment from causation", () => {
    expect(stableLayout(graph)).toEqual(
      stableLayout({ nodes: [...graph.nodes], edges: [...graph.edges] }),
    );
    const edge = graph.edges.find((e) => e.label === "章节")!;
    expect(
      relationExplanation(
        edge,
        built.nodeMap.get(edge.source)!,
        built.nodeMap.get(edge.target)!,
      ),
    ).toContain("不代表先后顺序或因果");
  });
  it("does not accept incomplete or wrongly ordered practice answers", () => {
    const ex = PRACTICES[0];
    expect(gradePractice(ex, ex.items).correct).toBe(false);
    expect(gradePractice(ex, ex.solution).correct).toBe(true);
    expect(gradePractice(PRACTICES[1], ["", "", "", ""]).complete).toBe(false);
  });
  it("a ring retains a route after an internal segment is disabled, but loses all routes when its supply is cut", () => {
    const ring: [string, string][] = [
      ["source", "A"],
      ["A", "B"],
      ["B", "C"],
      ["C", "D"],
      ["D", "A"],
    ];
    expect(reachableNodes(ring, 2, "source").size).toBe(5);
    expect(reachableNodes(ring, 0, "source")).toEqual(new Set(["source"]));
    expect(
      reachableNodes(
        [
          ["source", "A"],
          ["A", "B"],
          ["B", "C"],
        ],
        1,
        "source",
      ).has("C"),
    ).toBe(false);
  });
  it("restores valid learning records without stale nodes, pending responses or invalid counters", () => {
    const valid = graph.nodes[0].id;
    const value = {
      ...emptySession(),
      active: true,
      topic: "给水",
      turn: 50,
      hints: 90,
      selectedId: "missing",
      visited: [valid, "missing"],
      messages: [
        { id: "1", role: "assistant", content: "waiting", pending: true },
        {
          id: "2",
          role: "user",
          content: "my idea",
          nodeIds: [valid, "missing"],
        },
      ],
      saved: [{ nodeId: valid, note: "我的笔记", x: Infinity, y: -20 }],
      links: [[valid, "missing"]],
    };
    const result = restoreSession(value, new Set(graph.nodes.map((n) => n.id)));
    expect(result.active).toBe(true);
    expect(result.turn).toBe(3);
    expect(result.hints).toBe(4);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].nodeIds).toEqual([valid]);
    expect(result.selectedId).toBe(null);
    expect(result.visited).toEqual([valid]);
    expect(result.links).toEqual([]);
    expect(result.saved[0].x).toBe(0);
    expect(result.saved[0].y).toBe(0);
  });
});
