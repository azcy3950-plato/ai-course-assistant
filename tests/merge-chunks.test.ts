import { describe, it, expect } from "vitest";
import { mergeChunks } from "../src/lib/merge-chunks";

describe("mergeChunks", () => {
  it("向量优先,关键词补充去重", () => {
    const vector = [
      { doc_name: "海绵城市.pptx", content: "海绵城市定义是 AAAAA", similarity: 0.8 },
      { doc_name: "给水规划.pptx", content: "给水工程内容 BBBBB", similarity: 0.6 },
    ];
    const keyword = [
      { doc_name: "海绵城市.pptx", content: "海绵城市定义是 AAAAA", similarity: 3 }, // 重复
      { doc_name: "排水规划.pptx", content: "排水管网 CCCCC", similarity: 2 },       // 补充
    ];
    const merged = mergeChunks(vector, keyword, 8);
    expect(merged.map((c) => c.doc_name)).toEqual(["海绵城市.pptx", "给水规划.pptx", "排水规划.pptx"]);
  });

  it("limit 生效且去重按 doc+内容前 40 字", () => {
    const prefix = "相同的开头内容重复出现相同的开头内容重复出现相同的开头内容重复出现相同的开头内容重复出现"; // 40 字,达到指纹窗口
    const vector = [
      { doc_name: "a.pdf", content: prefix + "后续AAA" },
      { doc_name: "a.pdf", content: prefix + "后续BBB" },
    ];
    const merged = mergeChunks(vector, [], 2);
    expect(merged.length).toBe(1); // 前 40 字相同 → 视为重复
  });

  it("空输入安全", () => {
    expect(mergeChunks([], [], 8)).toEqual([]);
    expect(mergeChunks([{ doc_name: "" }], [], 8)).toEqual([]);
  });
});
