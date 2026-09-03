import { describe, expect, it } from "vitest";
import {
  deriveDynamicVisualStats,
  mapPondingSurfaceVisual,
  mapWaterVisual,
  sampleSeries,
} from "../src/app/sandbox/dynamic-visuals";

describe("动态沙盘视觉映射", () => {
  it("在相邻 SWMM 报告步之间做线性插值并限制边界", () => {
    expect(sampleSeries([0, 10, 30], 0.5)).toBeCloseTo(5);
    expect(sampleSeries([0, 10, 30], 1.25)).toBeCloseTo(15);
    expect(sampleSeries([0, 10, 30], -5)).toBe(0);
    expect(sampleSeries([0, 10, 30], 99)).toBe(30);
    expect(sampleSeries(undefined, 1)).toBe(0);
  });

  it("使用 P95 参考值削弱单个极端值对全场可见性的影响", () => {
    const result = {
      nodes: {
        J1: { depth: [0, 0.1, 0.2, 0.3, 8], pondedVolume: [0, 1, 2, 3, 100] },
        J2: { depth: [0.1, 0.15, 0.2, 0.25], pondedVolume: [0, 1, 2, 3] },
      },
      links: { P1: { flow: [0, 1, 2, 40], velocity: [0, 0.5, 1, 20] } },
      summary: { maxDepth: { value: 8 }, maxFlow: { value: 40 } },
    };
    const stats = deriveDynamicVisualStats(result);
    expect(stats.depthReference).toBeGreaterThan(0.2);
    expect(stats.depthReference).toBeLessThan(8);
    expect(stats.pondingReference).toBeLessThan(100);
    expect(stats.velocityReference).toBeGreaterThan(1);
  });

  it("小水深仍可见，显示高度单调增长且强度档位只改变视觉尺寸", () => {
    const small = mapWaterVisual(0.01, 1, "standard", 5);
    const medium = mapWaterVisual(0.25, 1, "standard", 5);
    const strong = mapWaterVisual(0.25, 1, "strong", 5);
    expect(small.height).toBeGreaterThanOrEqual(0.18);
    expect(medium.height).toBeGreaterThan(small.height);
    expect(strong.height).toBeGreaterThan(medium.height);
    expect(strong.radius).toBeGreaterThan(medium.radius);
    expect(mapWaterVisual(0, 1, "standard", 5).height).toBe(0);
  });

  it("地面积水半径使用平方根映射并受视觉强度控制", () => {
    const low = mapPondingSurfaceVisual(1, 100, "standard");
    const high = mapPondingSurfaceVisual(25, 100, "standard");
    const emphasized = mapPondingSurfaceVisual(25, 100, "strong");
    expect(high.radius).toBeGreaterThan(low.radius);
    expect(high.opacity).toBeGreaterThan(low.opacity);
    expect(emphasized.radius).toBeGreaterThan(high.radius);
  });
});
