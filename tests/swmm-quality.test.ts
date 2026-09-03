import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSwmmOutfallLoadingSummary,
  parseSwmmOutfalls,
  parseSwmmPollutants,
  summarizeSwmmQualityModel,
} from "../src/lib/swmm-quality";

describe("SWMM 真实水质数据契约", () => {
  const inp = readFileSync(join(process.cwd(), "public", "zijing_inp.inp"), "utf-8");
  const routeSource = readFileSync(join(process.cwd(), "src", "app", "api", "swmm", "route.ts"), "utf-8");

  it("从实际 INP 保留污染物顺序、单位与 CMS 质量换算", () => {
    expect(parseSwmmPollutants(inp)).toEqual([
      { name: "COD", concentrationUnit: "MG/L", massUnit: "kg", cmsMassRateFactor: 1e-3 },
      { name: "TP", concentrationUnit: "MG/L", massUnit: "kg", cmsMassRateFactor: 1e-3 },
      { name: "TN", concentrationUnit: "MG/L", massUnit: "kg", cmsMassRateFactor: 1e-3 },
    ]);
  });

  it("从实际 INP 读取全部出水口，包括数字 ID", () => {
    expect(parseSwmmOutfalls(inp)).toEqual(["P1", "P2", "P3", "1"]);
  });

  it("暴露实际水质覆盖范围，不把模型零负荷伪装成接口缺失", () => {
    expect(summarizeSwmmQualityModel(inp)).toEqual({
      totalSubcatchments: 931,
      coveredSubcatchments: 29,
      coveragePercent: 3.1,
      coveredSubcatchmentsFullyOccupiedByLid: 28,
    });
  });

  it("按污染物定义顺序解析 SWMM Outfall Loading Summary", () => {
    const report = `
***********************
Outfall Loading Summary
***********************

-----------------------------------------------------------------------------------------------
                       Flow       Avg       Max       Total       Total       Total       Total
                       Freq      Flow      Flow      Volume         COD          TP          TN
Outfall Node           Pcnt       CMS       CMS    10^6 ltr          kg          kg          kg
-----------------------------------------------------------------------------------------------
P1                    48.20     0.021     0.315       0.122       4.210       0.331       0.125
1                     12.00     0.010     0.100       0.050       1.000       0.100       0.050
-----------------------------------------------------------------------------------------------
System                30.10     0.031     0.415       0.172       5.210       0.431       0.175
`;
    const parsed = parseSwmmOutfallLoadingSummary(report, ["COD", "TP", "TN"]);
    expect(parsed?.system).toMatchObject({
      id: "System",
      totalVolumeMillionLiters: 0.172,
      pollutantLoads: { COD: 5.21, TP: 0.431, TN: 0.175 },
    });
    expect(parsed?.rows["1"].pollutantLoads.TN).toBe(0.05);
  });

  it("报告缺少引擎 System 汇总行时不伪造总负荷", () => {
    expect(parseSwmmOutfallLoadingSummary("Outfall Loading Summary\nno data", ["COD"])).toBeNull();
  });

  it("使用 swmm-toolkit 动态污染物枚举，禁止把裸整数当作 NodeAttribute", () => {
    expect(routeSource).toContain("OutputMetadata(out.handle)");
    expect(routeSource).toContain('getattr(NodeAttribute, "POLLUT_CONC_" + str(pollutant_index))');
    expect(routeSource).not.toContain("pollutant_base_attr");
  });
});
