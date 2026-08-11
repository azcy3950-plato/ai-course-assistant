import { describe, it, expect } from "vitest";
import { applyValvesStorages } from "../src/lib/swmm-inject";

const inp = `[TITLE]
test

[JUNCTIONS]
;;Name           Elev  MaxDepth InitDepth SurDepth Aponded
J1               10    3       0         0        0
J2               9     4       0         0

[XSECTIONS]
;;Name           Shape    Geom1   Geom2
P1               CIRCULAR 1.0     0
P2               CIRCULAR 0.8     0
P3               RECT_OPEN 1.5    0

[OUTFALLS]
O1               8       0       0
`;

describe("applyValvesStorages", () => {
  it("无阀门/蓄水时原样返回且 affected 为空", () => {
    const r = applyValvesStorages(inp);
    expect(r.text).toBe(inp);
    expect(r.affected.valves).toEqual([]);
    expect(r.affected.storages).toEqual([]);
  });

  it("阀门开度缩放圆管直径(0.3+0.7k),记录 affected", () => {
    const r = applyValvesStorages(inp, { P1: 0.5, P2: 1, P3: 0.2 });
    const xs = r.text.split("\n").find(l => l.startsWith("P1\t"))!;
    expect(xs.split("\t")[2]).toBe((1.0 * (0.3 + 0.7 * 0.5)).toFixed(4)); // 0.6500
    const xs2 = r.text.split("\n").find(l => l.startsWith("P2\t"))!;
    expect(xs2.split("\t")[2]).toBe((0.8 * 1).toFixed(4)); // k=1 原直径
    expect(r.affected.valves).toEqual(["P1", "P2"]); // P3 不存在被忽略
  });

  it("蓄水容量折算 Aponded(容量/0.5),缺省 Aponded 补列,记录 affected", () => {
    const r = applyValvesStorages(inp, undefined, [
      { nodeId: "J1", capacity: 500 },
      { nodeId: "J2", capacity: 1000 },
      { nodeId: "NOPE", capacity: 100 },
    ]);
    const j1 = r.text.split("\n").find(l => l.startsWith("J1\t"))!;
    expect(parseFloat(j1.split("\t")[5])).toBeCloseTo(0 + 500 / 0.5); // 1000
    const j2 = r.text.split("\n").find(l => l.startsWith("J2\t"))!;
    expect(parseFloat(j2.split("\t")[5])).toBeCloseTo(1000 / 0.5); // 补列 2000
    expect(r.affected.storages).toEqual(["J1", "J2"]); // 不存在的节点忽略
  });

  it("非法开度/容量不注入(钳制在前端与 route 层完成)", () => {
    const r = applyValvesStorages(inp, { P1: 1.5 }, [{ nodeId: "J1", capacity: -5 }]);
    expect(r.affected.valves).toEqual([]);
    expect(r.affected.storages).toEqual([]);
    expect(r.text.split("\n").find(l => l.trim().startsWith("P1 "))!.trim().split(/\s+/)[2]).toBe("1.0");
  });

  it("非 CIRCULAR 截面不缩放 + k=0 缩到 0.3d", () => {
    const r = applyValvesStorages(inp, { P3: 0.5, P1: 0 });
    // RECT_OPEN 跳过,geom1 不变
    expect(r.text.split("\n").find(l => l.trim().startsWith("P3 "))!.trim().split(/\s+/)[2]).toBe("1.5");
    // k=0 → d * 0.3
    const p1row = r.text.split("\n").find(l => l.trim().split(/\s+/)[0] === "P1")!;
    expect(p1row.trim().split(/\s+/)[2]).toBe((1.0 * 0.3).toFixed(4));
    expect(r.affected.valves).toEqual(["P1"]);
  });
});
