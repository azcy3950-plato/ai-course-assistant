import { describe, it, expect } from "vitest";
import { computeNetworkMastery, weakestNodes, networkIdOf } from "../src/lib/mastery-stats";
import type { KnowledgeNode } from "../src/types/knowledge-graph";

function node(id: string, mastery?: number): KnowledgeNode {
  return {
    id,
    name: id,
    description: "",
    chapter: "",
    keywords: [],
    category: "core",
    ...(mastery !== undefined ? { progress: { mastery, questionCount: 0, studyCount: 0, quizCorrect: 0, quizTotal: 0, lastStudiedAt: "" } } : {}),
  } as KnowledgeNode;
}

describe("mastery-stats", () => {
  it("networkIdOf 提取前缀", () => {
    expect(networkIdOf("water:runoff")).toBe("water");
    expect(networkIdOf("overview:core")).toBe("overview");
    expect(networkIdOf("plain")).toBe("plain");
  });

  it("按网络聚合掌握度均值(只统计已学节点)", () => {
    const nodes = [
      node("water:a", 40), node("water:b", 80), node("water:c"), // 已学均值 (40+80)/2=60
      node("drainage:d", 20),
    ];
    const stats = computeNetworkMastery(nodes, ["water", "drainage", "overview"]);
    expect(stats.find((s) => s.networkId === "water")).toMatchObject({ total: 3, studied: 2, avg: 60 });
    expect(stats.find((s) => s.networkId === "drainage")).toMatchObject({ total: 1, studied: 1, avg: 20 });
    expect(stats.find((s) => s.networkId === "overview")).toMatchObject({ total: 0, studied: 0, avg: 0 });
  });

  it("最薄弱节点:已学升序优先,不足补未学", () => {
    const nodes = [node("a", 90), node("b", 10), node("c", 50), node("d"), node("e")];
    const weak = weakestNodes(nodes, 3);
    expect(weak.map((n) => n.id)).toEqual(["b", "c", "d"]);
  });
});
