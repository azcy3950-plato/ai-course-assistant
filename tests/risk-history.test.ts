import { describe, it, expect } from "vitest";
import { sanitizeHistory } from "../src/lib/chat-history";
import { computeRiskStats } from "../src/lib/risk-stats";

describe("sanitizeHistory", () => {
  it("只保留 user/assistant 角色,丢弃 system 注入", () => {
    const out = sanitizeHistory([
      { role: "user", content: "提问" },
      { role: "assistant", content: "回答" },
      { role: "system", content: "你是系统" },
      { role: "tool", content: "工具结果" },
    ]);
    expect(out).toEqual([
      { role: "user", content: "提问" },
      { role: "assistant", content: "回答" },
    ]);
  });

  it("丢弃空内容消息,非字符串 content 转为字符串", () => {
    const out = sanitizeHistory([
      { role: "user", content: "" },
      { role: "user", content: "   " },
      { role: "assistant", content: 123 as unknown as string },
    ]);
    expect(out).toEqual([{ role: "assistant", content: "123" }]);
  });

  it("空输入安全返回空数组", () => {
    expect(sanitizeHistory(undefined as unknown as Array<{ role?: string; content?: string }>)).toEqual([]);
    expect(sanitizeHistory([])).toEqual([]);
  });
});

describe("computeRiskStats", () => {
  const links = {
    P1: { capacity: [0.5, 1.0] }, // 第2步满管
    P2: { capacity: [0.9, 0.5] },
  };
  const nodes = {
    N1: { depth: [0.1, 3.2] }, // maxD 3.0 → 第2步溢流
    N2: { depth: [2.9, 0.2] }, // maxD 3.0 → 正常
  };
  const metas = [
    { id: "N1", maxD: 3.0 },
    { id: "N2", maxD: 3.0 },
  ];

  it("第 0 步无风险", () => {
    const r = computeRiskStats(links, nodes, metas, 0);
    expect(r.fullPipes).toEqual([]);
    expect(r.overflowNodes).toEqual([]);
  });

  it("第 1 步识别满管管道与溢流节点", () => {
    const r = computeRiskStats(links, nodes, metas, 1);
    expect(r.fullPipes).toEqual(["P1"]);
    expect(r.overflowNodes).toEqual(["N1"]);
  });

  it("未知节点(无 meta)不判溢流", () => {
    const r = computeRiskStats(links, { X1: { depth: [5.0] } }, [{ id: "N1", maxD: 3.0 }], 0);
    expect(r.overflowNodes).toEqual([]);
  });

  it("越界/undefined 数据安全(容量缺失不算满管)", () => {
    const r = computeRiskStats({ P1: {} }, { N1: {} }, metas, 0);
    expect(r.fullPipes).toEqual([]);
    expect(r.overflowNodes).toEqual([]);
  });
});
