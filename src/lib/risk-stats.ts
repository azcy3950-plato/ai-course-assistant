// 仿真风险统计(纯函数):当前时间步的满管管道与溢流节点

export interface RiskNodeMeta { id: string; maxD?: number }
export interface RiskStats {
  fullPipes: string[];
  overflowNodes: string[];
}

export function computeRiskStats(
  links: Record<string, { capacity?: number[] }> | undefined,
  nodes: Record<string, { depth?: number[] }> | undefined,
  nodeMetas: RiskNodeMeta[] | undefined,
  dynStep: number,
): RiskStats {
  const fullPipes: string[] = [];
  if (links) {
    Object.entries(links).forEach(([id, ld]) => {
      const cap = ld?.capacity;
      const c = (cap && dynStep < cap.length) ? cap[dynStep] : 0;
      if (c > 0.98) fullPipes.push(id);
    });
  }
  const overflowNodes: string[] = [];
  if (nodes) {
    Object.entries(nodes).forEach(([id, nd]) => {
      const meta = nodeMetas?.find((n) => n.id === id);
      const depths = nd?.depth;
      const depth = (depths && dynStep < depths.length) ? depths[dynStep] : 0;
      if (meta && depth > (meta.maxD || 99)) overflowNodes.push(id);
    });
  }
  return { fullPipes, overflowNodes };
}
