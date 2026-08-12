import { describe, it, expect } from "vitest";
import { buildKeywordSearch } from "../src/lib/keyword-search";

describe("buildKeywordSearch", () => {
  it("中文问题切词并参数化(带 % 通配包裹)", () => {
    const q = buildKeywordSearch("什么是海绵城市,渗透铺装如何工作");
    expect(q.params.length).toBeGreaterThanOrEqual(2);
    expect(q.params[0]).toBe("%海绵城市%");
    expect(q.params.some((p) => p.includes("渗透铺装"))).toBe(true);
    expect(q.sql).toContain("FROM document_chunks");
    expect(q.sql).toContain("ILIKE $1");
    expect(q.sql).toContain("ORDER BY hit_score DESC");
  });

  it("用户输入中的 LIKE 通配符被转义(防注入)", () => {
    const q = buildKeywordSearch("50% 流量 %_ OR 1=1");
    for (const p of q.params) {
      // 每个参数都是 %...% 包裹的转义词,不包含裸通配符或注入片段
      expect(p).not.toMatch(/(^|[^\\])OR 1=1/i);
    }
    expect(q.sql).not.toContain("OR 1=1");
  });

  it("纯停用词/短词时退化为全表前 N 条(不报错,仍查知识库)", () => {
    const q = buildKeywordSearch("的 吗 呢");
    expect(q.params).toEqual([]);
    expect(q.sql).toContain("FROM document_chunks");
    expect(q.sql).toContain("LIMIT 6");
  });

  it("limit 参数生效", () => {
    const q = buildKeywordSearch("海绵城市 排水 管网", 4);
    expect(q.sql).toContain("LIMIT 4");
  });

  it("超长问题截断 200 字且词数上限 8(防全表扫描滥用)", () => {
    const long = Array.from({ length: 60 }, (_, i) => `关键词${i}`).join(" ");
    const q = buildKeywordSearch(long);
    // 60 个词被截到 8 个:每词 3 列×2 处 ILIKE,共 8×6=48 处;params 恰 8
    expect(q.sql.match(/ILIKE \$/g)?.length).toBe(48);
    expect(q.params.length).toBe(8);
  });

  it("LIMIT 钳制:999→20、负数/NaN 兜底", () => {
    expect(buildKeywordSearch("海绵", 999).sql).toContain("LIMIT 20");
    expect(buildKeywordSearch("海绵", -5).sql).toContain("LIMIT 1");
    expect(buildKeywordSearch("海绵", Number.NaN).sql).toContain("LIMIT 6");
    // 退化分支同样钳制
    expect(buildKeywordSearch("的 吗", 999).sql).toContain("LIMIT 20");
  });
});
