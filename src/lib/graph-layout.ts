// 图谱多阶径向布局(纯函数,可单测)
import type { KnowledgeNode } from "../types";

export type Placed = { node: KnowledgeNode; x: number; y: number; depth: number };

export function hashString(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
export function seededOffset(seed: number, range: number) { const x = Math.sin(seed) * 10000; return (x - Math.floor(x) - 0.5) * 2 * range; }

/**
 * 多阶径向布局(完整图谱):根(焦点)居中,BFS 按连接层级分层,
 * 每层节点均匀分布在半径递增的圆环上;孤立/远层节点放最外环。
 */
export function computeLayout(nodes: KnowledgeNode[], edges: { source: string; target: string }[], rootId: string | undefined, _depth: 1 | 2, width: number, height: number): Placed[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const minSize = Math.min(width, height);
  const adj = new Map<string, Set<string>>();
  nodes.forEach((n) => adj.set(n.id, new Set()));
  edges.forEach((e) => { adj.get(e.source)?.add(e.target); adj.get(e.target)?.add(e.source); });
  const root = nodes.find((n) => n.id === rootId) || nodes[0];
  if (!root) return [];
  const placed = new Map<string, Placed>();
  placed.set(root.id, { node: root, x: centerX, y: centerY, depth: 0 });

  // BFS 分层:按连接层级分配环半径,完整图所有节点都参与布局
  const layers: string[][] = [[root.id]];
  const visited = new Set([root.id]);
  const queue: Array<{ id: string; depth: number }> = [{ id: root.id, depth: 0 }];
  while (queue.length) {
    const { id, depth } = queue.shift()!;
    const nextDepth = depth + 1;
    if (!layers[nextDepth]) layers[nextDepth] = [];
    adj.get(id)?.forEach((neighbor) => {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        layers[nextDepth].push(neighbor);
        queue.push({ id: neighbor, depth: nextDepth });
      }
    });
  }
  // 孤立节点(与根无连接)归入最外层
  const far = nodes.filter((n) => !visited.has(n.id));
  if (far.length) layers[layers.length] = far.map((n) => n.id);

  const startAngle = -Math.PI / 2;
  layers.forEach((layer, layerIndex) => {
    if (layerIndex === 0) return; // 根已居中
    const count = layer.length || 1;
    const baseRadius = minSize * (0.26 + (layerIndex - 1) * 0.15);
    const radius = Math.min(baseRadius, minSize * 0.44);
    const wobbleRange = minSize * (layerIndex <= 2 ? 0.014 : 0.010);
    layer.forEach((id, i) => {
      const angle = startAngle + (Math.PI * 2 * i) / count + seededOffset(hashString(id) + 3, 0.18);
      const wobble = seededOffset(hashString(id), wobbleRange);
      placed.set(id, { node: nodes.find((n) => n.id === id)!, x: centerX + Math.cos(angle) * radius + wobble, y: centerY + Math.sin(angle) * radius + wobble * 0.65, depth: Math.min(layerIndex, 3) });
    });
  });
  return [...placed.values()];
}
