import { describe, it, expect } from "vitest";
import { computeLayout } from "../src/lib/graph-layout";
import type { KnowledgeNode } from "../src/types";
function node(id: string, name?: string): KnowledgeNode {
  return { id, name: name || id, description: "", keywords: [], category: "core" } as KnowledgeNode;
}

describe("computeLayout", () => {
  const nodes = [node("A"), node("B"), node("C"), node("D"), node("E")];
  // A 连接 B/C;B 连接 D;E 孤立
  const edges = [
    { source: "A", target: "B" },
    { source: "A", target: "C" },
    { source: "B", target: "D" },
  ];

  it("根节点居中(depth 0,坐标等于画布中心)", () => {
    const placed = computeLayout(nodes, edges, "A", 1, 1400, 900);
    const root = placed.find((p) => p.node.id === "A")!;
    expect(root.depth).toBe(0);
    expect(root.x).toBe(700);
    expect(root.y).toBe(450);
  });

  it("BFS 分层深度正确(直接邻居 depth 1,隔层 depth 2)", () => {
    const placed = computeLayout(nodes, edges, "A", 2, 1400, 900);
    const byId = new Map(placed.map((p) => [p.node.id, p.depth]));
    expect(byId.get("A")).toBe(0);
    expect(byId.get("B")).toBe(1);
    expect(byId.get("C")).toBe(1);
    expect(byId.get("D")).toBe(2);
  });

  it("孤立节点归入最外层且仍被布局", () => {
    const placed = computeLayout(nodes, edges, "A", 1, 1400, 900);
    const e = placed.find((p) => p.node.id === "E")!;
    expect(e.depth).toBeGreaterThan(0);
    // 孤立节点与根不重合
    expect(Math.abs(e.x - 700) + Math.abs(e.y - 450)).toBeGreaterThan(10);
  });

  it("全部节点都被布局(数量一致)", () => {
    const placed = computeLayout(nodes, edges, "A", 2, 1400, 900);
    expect(placed.length).toBe(5);
  });

  it("空节点列表安全返回空数组", () => {
    expect(computeLayout([], [], undefined, 1, 100, 100)).toEqual([]);
  });

  it("指定不存在的根时回退到第一个节点", () => {
    const placed = computeLayout(nodes, edges, "NOPE", 1, 1400, 900);
    const root = placed.find((p) => p.depth === 0)!;
    expect(root.node.id).toBe("A");
  });

  it("同层节点分布在圆心外(半径 > 0)", () => {
    const placed = computeLayout(nodes, edges, "A", 1, 1400, 900);
    const b = placed.find((p) => p.node.id === "B")!;
    const dist = Math.hypot(b.x - 700, b.y - 450);
    expect(dist).toBeGreaterThan(100);
  });
});
