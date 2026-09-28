import { describe, it, expect } from "vitest";
import { parseInp } from "../src/lib/inp-parser";

const MINIMAL_INP = `[COORDINATES]
;;XCoord           YCoord
J1               529350.0          305850.0
J2               529360.0          305860.0
[VERTICES]
[Polygons]
S1               529340.0          305840.0
S1               529350.0          305840.0
S1               529350.0          305850.0
S1               529340.0          305850.0
[JUNCTIONS]
;;Name           Elevation       MaxDepth       InitDepth
J1               12.5            3.0            0.0
J2               11.0            2.5            0.1
[OUTFALLS]
;;Name           Elevation
J2               11.0
[CONDUITS]
;;Name           FromNode        ToNode          Length     Roughness   InOffset    OutOffset
C1               J1              J2              50.0       0.013       0.0         0.0
[XSECTIONS]
;;Link           Shape           Geom1          Geom2
C1               CIRCULAR        0.5            0.0
[SUBCATCHMENTS]
;;Name           RainGage        Outlet          Area       %Imperv    Width      %Slope
S1               RG1             J1              0.5        60.0       20.0       1.0
[SUBAREAS]
;;Subcatchment   N-Imperv        N-Perv
S1               0.02            0.15
`;

describe("parseInp", () => {
  it("解析节点坐标并做中心偏移换算", () => {
    const r = parseInp(MINIMAL_INP);
    const j1 = r.nodes.find((n) => n.id === "J1");
    expect(j1).toBeDefined();
    expect(j1!.x).toBeCloseTo(529350 - 529350, 6); // 0
    expect(j1!.z).toBeCloseTo(-(305850 - 305850), 6); // 0
    expect(j1!.invert).toBe(12.5);
    expect(j1!.maxD).toBe(3.0);
    expect(j1!.ground).toBe(15.5);
  });

  it("识别出水口节点类型", () => {
    const r = parseInp(MINIMAL_INP);
    expect(r.outfallIds.has("J2")).toBe(true);
    expect(r.nodes.find((n) => n.id === "J2")!.type).toBe("outfall");
  });

  it("解析管道与断面(直径/糙率/形状)", () => {
    const r = parseInp(MINIMAL_INP);
    const c1 = r.pipes.find((p) => p.id === "C1")!;
    expect(c1).toBeDefined();
    expect(c1.from).toBe("J1");
    expect(c1.to).toBe("J2");
    expect(c1.diam).toBe(0.5);
    expect(c1.roughness).toBeCloseTo(0.013);
    expect(c1.shape).toBe("CIRCULAR");
    expect(c1.fromInv).toBe(12.5);
    expect(c1.toInv).toBe(11.0);
  });

  it("解析汇水区(面积/不透水率/出口/多边形点数)", () => {
    const r = parseInp(MINIMAL_INP);
    const s1 = r.scs.find((s) => s.id === "S1")!;
    expect(s1).toBeDefined();
    expect(s1.area).toBe(0.5);
    expect(s1.imperv).toBe(60);
    expect(s1.outlet).toBe("J1");
    expect(s1.pts.length).toBe(4);
  });

  it("段头大小写不敏感([Polygons]/[POLYGONS])", () => {
    const upper = MINIMAL_INP.replace("[Polygons]", "[POLYGONS]");
    const r = parseInp(upper);
    expect(r.scs.length).toBe(1);
  });

  it("缺少段头时安全返回空结构", () => {
    const r = parseInp("[JUNCTIONS]\nJ1 1.0 2.0 0.0");
    expect(r.nodes.length).toBe(0);
    expect(r.pipes.length).toBe(0);
    expect(r.scs.length).toBe(0);
  });
});
