import { describe, it, expect } from "vitest";
import { matchGraphContext } from "../src/lib/knowledge-graph";

// matchGraphContext 为纯本地关键词匹配(无 DB 依赖),验证扩词表后命中质量
describe("matchGraphContext 关键词匹配", () => {
  it("「什么是透水铺装」命中海绵城市网络设施节点", async () => {
    const ctx = await matchGraphContext("什么是透水铺装", undefined, [], "");
    expect(ctx.focusNode).toBeTruthy();
    // 透水铺装属于海绵网络(节点 id 前缀 sponge)
    expect(String(ctx.focusNode.id).startsWith("sponge")).toBe(true);
  });

  it("「雨水花园如何削减径流」命中海绵/排水相关节点", async () => {
    const ctx = await matchGraphContext("雨水花园如何削减径流", undefined, [], "");
    const id = String(ctx.focusNode.id);
    expect(id.startsWith("sponge") || id.startsWith("drainage")).toBe(true);
  });

  it("「城市污水二级处理工艺」命中污水处理网络", async () => {
    const ctx = await matchGraphContext("城市污水二级处理工艺", undefined, [], "");
    expect(String(ctx.focusNode.id).startsWith("wastewater")).toBe(true);
    // 命中章节时联动其 items 高亮
    expect(ctx.highlightNodeIds.length).toBeGreaterThanOrEqual(1);
  });

  it("命中章节节点时联动其 items 一并高亮", async () => {
    const ctx = await matchGraphContext("城市供水管网布置", undefined, [], "");
    if (String(ctx.focusNode.id).startsWith("water:1:")) {
      // category 节点命中 → items 加入 highlightNodeIds
      expect(ctx.highlightNodeIds.length).toBeGreaterThan(1);
    }
  });
});
