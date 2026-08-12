/**
 * 掌握度聚合纯函数(可单测):按网络 id 前缀聚合节点掌握度,计算每网络均值与最薄弱节点。
 * 节点 id 形如 "water:xxx" / "drainage:xxx",前缀即网络 id。
 */
import type { KnowledgeNode } from "@/types/knowledge-graph";

export interface NetworkMastery {
  networkId: string;
  total: number;      // 该网络节点总数
  studied: number;    // 有掌握度记录的节点数
  avg: number;        // 已学节点平均掌握度(0-100;无已学节点时为 0)
}

export function networkIdOf(nodeId: string): string {
  const idx = nodeId.indexOf(":");
  return idx > 0 ? nodeId.slice(0, idx) : nodeId;
}

export function computeNetworkMastery(nodes: KnowledgeNode[], networkIds: string[]): NetworkMastery[] {
  const groups = new Map<string, KnowledgeNode[]>();
  for (const n of nodes) {
    const id = networkIdOf(n.id);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(n);
  }
  return networkIds.map((networkId) => {
    const group = groups.get(networkId) || [];
    const studied = group.filter((n) => n.progress?.mastery !== undefined);
    const avg = studied.length
      ? Math.round(studied.reduce((s, n) => s + (n.progress!.mastery || 0), 0) / studied.length)
      : 0;
    return { networkId, total: group.length, studied: studied.length, avg };
  });
}

/** 最薄弱节点:已学中掌握度最低的前 n-1 个(升序),其余位由未学节点补足;取前 n 个 */
export function weakestNodes(nodes: KnowledgeNode[], n = 3): KnowledgeNode[] {
  const studied = nodes.filter((node) => node.progress?.mastery !== undefined)
    .sort((a, b) => (a.progress!.mastery || 0) - (b.progress!.mastery || 0));
  const rest = nodes.filter((node) => node.progress?.mastery === undefined);
  const head = studied.slice(0, Math.max(1, n - 1));
  return [...head, ...rest].slice(0, n);
}
