import { describe, it, expect } from "vitest";
import { NETWORK_DEFS } from "../src/lib/knowledge-map-data";
import { buildAllNetworks, buildNetwork, hashString, inferKind } from "../src/lib/knowledge-map-builder";

describe("knowledge-map-builder", () => {
  it("NETWORK_DEFS 覆盖 8 个网络(总览+7 专题)", () => {
    expect(NETWORK_DEFS.map(d => d.id)).toEqual([
      "overview", "general", "water", "drainage", "wastewater", "sponge", "power", "resilience",
    ]);
  });

  it("生成节点数 > 250,每网络根/章节/知识点三层齐备", () => {
    const nets = buildAllNetworks();
    const total = nets.reduce((s, n) => s + n.nodes.length, 0);
    expect(total).toBeGreaterThan(250);
    for (const net of nets) {
      const roots = net.nodes.filter(n => n.category === "core");
      const sections = net.nodes.filter(n => n.category === "category");
      const leaves = net.nodes.filter(n => n.category !== "core" && n.category !== "category");
      expect(roots.length).toBe(1);
      expect(sections.length).toBeGreaterThanOrEqual(5);
      // overview(总览)章节无叶子(点击跳转专题网络),其余网络叶子 >= 20
      if (net.def.id !== "overview") expect(leaves.length).toBeGreaterThanOrEqual(20);
      // 边:root→每 section + section→每 item
      expect(net.edges.length).toBe(net.nodes.length - 1);
    }
  });

  it("节点 id 全局唯一,hash 稳定", () => {
    const nets = buildAllNetworks();
    const ids = new Set<string>();
    for (const net of nets) for (const node of net.nodes) {
      expect(ids.has(node.id)).toBe(false);
      ids.add(node.id);
    }
    expect(hashString("给水管网")).toBe(hashString("给水管网"));
    expect(hashString("给水管网")).not.toBe(hashString("排水管网"));
  });

  it("overview 网络章节带 target 跳转(对应专题网络)", () => {
    const overview = NETWORK_DEFS.find(d => d.id === "overview")!;
    const targets = overview.sections.map(s => s.target).filter(Boolean);
    expect(targets).toEqual(["general", "water", "drainage", "wastewater", "sponge", "power", "resilience"]);
  });

  it("inferKind 按关键词推断概念/方法/标准/案例", () => {
    expect(inferKind("概念", "", "", [], 2, null)).toBe("concept");
    expect(inferKind("活性污泥法", "", "工艺", [], 2, null)).toBe("method");
    expect(inferKind("年径流率", "", "指标", [], 2, null)).toBe("standard");
    expect(inferKind("试点城市", "", "实践", [], 2, null)).toBe("case");
  });
});
