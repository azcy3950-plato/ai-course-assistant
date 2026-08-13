import { describe, it, expect } from "vitest";
import { routeQuestion, sanitizeDomain } from "../src/lib/qa-router";

describe("qa-router", () => {
  it("应急关键词命中(预案/洪水/内涝/处置)", () => {
    expect(routeQuestion("城市暴雨内涝应急处置预案是什么?").domain).toBe("emergency");
    expect(routeQuestion("洪水来临时怎么抢险?").domain).toBe("emergency");
    expect(routeQuestion("防涝应急预案").domain).toBe("emergency");
  });

  it("调研关键词命中(政策/规划/案例/数据/标准)", () => {
    expect(routeQuestion("海绵城市建设的相关政策有哪些?").domain).toBe("research");
    expect(routeQuestion("国外绿色基础设施规划案例").domain).toBe("research");
    expect(routeQuestion("SWMM模拟数据怎么解读?").domain).toBe("research");
  });

  it("未命中默认教学", () => {
    expect(routeQuestion("什么是海绵城市?").domain).toBe("teaching");
    expect(routeQuestion("透水铺装的工作原理").domain).toBe("teaching");
  });

  it("sanitizeDomain 白名单校验,非法回退教学", () => {
    expect(sanitizeDomain("emergency")).toBe("emergency");
    expect(sanitizeDomain("应急")).toBe("emergency");
    expect(sanitizeDomain("research")).toBe("research");
    expect(sanitizeDomain("teaching")).toBe("teaching");
    expect(sanitizeDomain("hacker")).toBe("teaching");
    expect(sanitizeDomain(null)).toBe("teaching");
    expect(sanitizeDomain(undefined)).toBe("teaching");
  });
});
