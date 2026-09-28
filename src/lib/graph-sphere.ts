import { Vector3 } from "three";
import type { KnowledgeGraph, KnowledgeNode } from "@/types";

export type SphereNode = {
  id: string; node: KnowledgeNode; depth: number;
  x: number; y: number; z: number;
  ax: number; ay: number; az: number;
  fx?: number; fy?: number; fz?: number;
};

function direction(index: number, count: number) {
  const y = 1 - 2 * (index + .5) / count;
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  const radius = Math.sqrt(1 - y * y);
  return new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
}

/** Compact spherical sectors keep each branch together without long radial spikes. */
export function sphereLayout(graph: KnowledgeGraph): SphereNode[] {
  const groups = new Map<string, KnowledgeNode[]>();
  graph.nodes.forEach(node => {
    const key = node.chapter || "";
    groups.set(key, [...(groups.get(key) || []), node]);
  });
  const result: SphereNode[] = [];
  [...groups.values()].forEach((nodes, groupIndex) => {
    const ids = new Set(nodes.map(n => n.id));
    const links = graph.edges.filter(e => ids.has(e.source) && ids.has(e.target));
    const incoming = new Set(links.map(e => e.target));
    const root = nodes.find(n => !incoming.has(n.id)) || nodes[0];
    const adjacent = new Map(nodes.map(n => [n.id, [] as string[]]));
    links.forEach(e => { adjacent.get(e.source)!.push(e.target); adjacent.get(e.target)!.push(e.source); });
    const children = new Map(nodes.map(n => [n.id, [] as string[]]));
    const depths = new Map([[root.id, 0]]), queue = [root.id];
    for (let i = 0; i < queue.length; i++) {
      for (const id of adjacent.get(queue[i])!) {
        if (depths.has(id)) continue;
        depths.set(id, depths.get(queue[i])! + 1); children.get(queue[i])!.push(id); queue.push(id);
      }
    }
    nodes.filter(n => !depths.has(n.id)).forEach(n => { children.get(root.id)!.push(n.id); depths.set(n.id, 1); });
    const center = groups.size > 1 ? direction(groupIndex, groups.size).multiplyScalar(215) : new Vector3();
    const scale = groups.size > 1 ? .48 : 1;
    const positions = new Map([[root.id, new Vector3()]]);
    const branches = children.get(root.id)!;
    branches.forEach((id, i) => {
      const axis = direction(i, branches.length);
      positions.set(id, axis.clone().multiplyScalar(nodes.length <= 10 ? 155 : 105));
      const tangent = new Vector3().crossVectors(axis, Math.abs(axis.y) > .9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)).normalize();
      const bitangent = new Vector3().crossVectors(axis, tangent).normalize();
      const descendants: string[] = [];
      const visit = (parent: string) => children.get(parent)!.forEach(child => { descendants.push(child); visit(child); });
      visit(id);
      descendants.forEach((child, j) => {
        const angle = j * Math.PI * (3 - Math.sqrt(5));
        const spread = .78 * Math.sqrt((j + .5) / descendants.length);
        const radius = 180 + Math.min(3, depths.get(child)! - 2) * 20;
        const point = axis.clone().addScaledVector(tangent, Math.cos(angle) * spread)
          .addScaledVector(bitangent, Math.sin(angle) * spread).normalize().multiplyScalar(radius);
        positions.set(child, point);
      });
    });
    nodes.forEach(node => {
      const point = positions.get(node.id)!.clone().multiplyScalar(scale).add(center);
      result.push({ id: node.id, node, depth: depths.get(node.id)!, x: point.x, y: point.y, z: point.z,
        ax: point.x, ay: point.y, az: point.z, fx: point.x, fy: point.y, fz: point.z });
    });
  });
  return result;
}
