/**
 * 知识问答领域路由(纯函数,可单测)。
 * 规则优先:关键词命中即定域;全部未命中时由上层调用 LLM 兜底分类(本模块提供白名单校验)。
 */
export type QaDomain = "teaching" | "research" | "emergency";

export interface RouteResult {
  domain: QaDomain;
  matchedBy: "keyword" | "default";
}

const KEYWORDS: Record<Exclude<QaDomain, "teaching">, string[]> = {
  emergency: [
    "预案", "洪水", "内涝", "泄洪", "抢险", "处置", "应急", "防涝", "排涝",
    "暴雨", "台风", "洪峰", "淹没", "积水", "避险", "救援", "预警", "响应",
  ],
  research: [
    "政策", "规划", "案例", "数据", "标准", "规范", "文件", "法规", "制度",
    "调研", "报告", "统计", "指标", "对比", "趋势", "背景", "历程", "实践",
  ],
};

export function routeQuestion(question: string): RouteResult {
  const q = String(question || "");
  // 调研语境优先(规划/案例/数据等弱于应急强词时,歧义交由上层 LLM 兜底更准);
  // 含调研词(规划/案例/标准)时判调研,否则查应急强词,再默认教学
  for (const domain of ["research", "emergency"] as const) {
    if (KEYWORDS[domain].some((kw) => q.includes(kw))) {
      return { domain, matchedBy: "keyword" };
    }
  }
  return { domain: "teaching", matchedBy: "default" };
}

/** LLM 兜底分类输出校验:只接受白名单三值,非法回退教学 */
export function sanitizeDomain(raw: unknown): QaDomain {
  if (raw === "emergency" || raw === "research" || raw === "teaching") return raw;
  if (typeof raw === "string") {
    const t = raw.trim().toLowerCase();
    if (t.includes("emergency") || t.includes("应急")) return "emergency";
    if (t.includes("research") || t.includes("调研")) return "research";
  }
  return "teaching";
}
