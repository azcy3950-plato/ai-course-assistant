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
});
