export type VisualStrength = "weak" | "standard" | "strong";

export const VISUAL_PROFILES: Record<VisualStrength, {
  height: number;
  radius: number;
  surface: number;
  glow: number;
}> = {
  weak: { height: 0.72, radius: 0.82, surface: 0.78, glow: 0.72 },
  standard: { height: 1, radius: 1, surface: 1, glow: 1 },
  strong: { height: 1.32, radius: 1.22, surface: 1.3, glow: 1.28 },
};

export interface DynamicVisualStats {
  depthReference: number;
  pondingReference: number;
  flowReference: number;
  velocityReference: number;
}

export interface WaterVisual {
  height: number;
  radius: number;
  ratio: number;
}

export interface SurfaceVisual {
  radius: number;
  opacity: number;
  ratio: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function percentile(values: number[], quantile = 0.95): number {
  const sorted = values.filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const q = clamp(quantile, 0, 1);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const mix = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * mix;
}

export function sampleSeries(series: unknown, playhead: number): number {
  if (!Array.isArray(series) || !series.length) return 0;
  const safeHead = clamp(playhead, 0, series.length - 1);
  const from = Math.floor(safeHead);
  const to = Math.min(series.length - 1, from + 1);
  const mix = safeHead - from;
  const a = Number(series[from]) || 0;
  const b = Number(series[to]) || 0;
  return a + (b - a) * mix;
}

export function deriveDynamicVisualStats(result: any): DynamicVisualStats {
  const depths: number[] = [];
  const ponding: number[] = [];
  const flows: number[] = [];
  const velocities: number[] = [];

  for (const node of Object.values(result?.nodes || {}) as any[]) {
    if (Array.isArray(node?.depth)) depths.push(...node.depth);
    if (Array.isArray(node?.pondedVolume)) ponding.push(...node.pondedVolume);
  }
  for (const link of Object.values(result?.links || {}) as any[]) {
    if (Array.isArray(link?.flow)) flows.push(...link.flow.map(Math.abs));
    if (Array.isArray(link?.velocity)) velocities.push(...link.velocity.map(Math.abs));
  }

  return {
    depthReference: Math.max(0.05, percentile(depths, 0.95), Number(result?.summary?.maxDepth?.value) * 0.72 || 0),
    pondingReference: Math.max(0.05, percentile(ponding, 0.95)),
    flowReference: Math.max(0.01, percentile(flows, 0.95), Number(result?.summary?.maxFlow?.value) * 0.72 || 0),
    velocityReference: Math.max(0.05, percentile(velocities, 0.95)),
  };
}

// P95 归一化 + 0.58 次幂：放大小水深，同时压缩极端峰值。
// 返回值只用于 Three.js 显示，不改变 SWMM 原始水深。
export function mapWaterVisual(
  depth: number,
  referenceDepth: number,
  strength: VisualStrength,
  verticalExaggeration = 5,
): WaterVisual {
  if (!Number.isFinite(depth) || depth <= 0.0005) return { height: 0, radius: 0, ratio: 0 };
  const profile = VISUAL_PROFILES[strength];
  const ratio = clamp(depth / Math.max(0.01, referenceDepth), 0, 1);
  const shaped = Math.pow(ratio, 0.58);
  const maxHeight = Math.max(4.2, verticalExaggeration * 2.15) * profile.height;
  return {
    height: Math.max(0.18 * profile.height, shaped * maxHeight),
    radius: (0.26 + shaped * 0.24) * profile.radius,
    ratio,
  };
}

export function mapDepthSurfaceVisual(
  depth: number,
  referenceDepth: number,
  strength: VisualStrength,
): SurfaceVisual {
  if (!Number.isFinite(depth) || depth <= 0.001) return { radius: 0, opacity: 0, ratio: 0 };
  const profile = VISUAL_PROFILES[strength];
  const ratio = clamp(depth / Math.max(0.01, referenceDepth), 0, 1);
  return {
    radius: (0.6 + 2.45 * Math.pow(ratio, 0.62)) * profile.surface,
    opacity: 0.2 + ratio * 0.42,
    ratio,
  };
}

// 地面积水面积用平方根映射：面积感随体积增长，同时避免极端值占满场景。
export function mapPondingSurfaceVisual(
  pondedVolume: number,
  referenceVolume: number,
  strength: VisualStrength,
): SurfaceVisual {
  if (!Number.isFinite(pondedVolume) || pondedVolume <= 0.001) return { radius: 0, opacity: 0, ratio: 0 };
  const profile = VISUAL_PROFILES[strength];
  const ratio = clamp(pondedVolume / Math.max(0.01, referenceVolume), 0, 1);
  return {
    radius: (0.82 + 3.3 * Math.sqrt(ratio)) * profile.surface,
    opacity: 0.24 + ratio * 0.36,
    ratio,
  };
}
