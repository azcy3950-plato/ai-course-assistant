// 从 NETWORK_DEFS 生成 8 个知识网络的节点/边(与参考网站 normalizeNetwork 逻辑一致)
import { NETWORK_DEFS, type NetworkDef, type KnowledgeNodeKind } from "./knowledge-map-data";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode, StudentNodeProgress } from "@/types/knowledge-graph";

export function hashString(input: string): number {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function inferKind(label: string, full: string, summary: string, keywords: string[], depth: number, target?: string | null): KnowledgeNodeKind {
  const text = [label, full, summary, ...keywords].join(" ");
  if (depth === 0) return "core";
  if (depth === 1) return "category";
  if (/案例|试点|平台|实践|经验|建设/.test(text)) return "case";
  if (/标准|指标|率|系数|规范|导则|意见|目标|排放/.test(text)) return "standard";
  if (/背景|概念|理论|定义|历史|作用|分类|框架|导向/.test(text)) return "concept";
  if (/法|技术|工艺|处理|计算|布置|设计|铺装|花园|湿地|沟|泵|管网|过滤|沉淀|消毒|调蓄|排水|给水|取水|净水|污水/.test(text)) return "method";
  return "detail";
}

export interface BuiltNetwork {
  def: NetworkDef;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  nodeMap: Map<string, KnowledgeNode>;
}

function nodeId(networkId: string, depth: number, sectionIndex: number, itemIndex: number, full: string): string {
  return `${networkId}:${depth}:${sectionIndex}:${itemIndex}:${hashString(full)}`;
}

export function buildNetwork(def: NetworkDef): BuiltNetwork {
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const nodeMap = new Map<string, KnowledgeNode>();

  const rootId = nodeId(def.id, 0, 0, 0, def.root.full);
  const root: KnowledgeNode = {
    id: rootId,
    name: def.root.label,
    description: def.root.summary || "",
    chapter: def.title,
    keywords: def.root.keywords || [],
    category: "core",
    resources: [],
  };
  nodes.push(root);
  nodeMap.set(rootId, root);

  def.sections.forEach((section, sectionIndex) => {
    const sectionId = nodeId(def.id, 1, sectionIndex, 0, section.full);
    const sectionNode: KnowledgeNode = {
      id: sectionId,
      name: section.label,
      description: section.summary || "",
      chapter: def.title,
      keywords: [section.full],
      category: "category",
      resources: [],
    };
    nodes.push(sectionNode);
    nodeMap.set(sectionId, sectionNode);
    edges.push({
      id: `${sectionId}:edge`,
      source: rootId,
      target: sectionId,
      relation: "leads_to",
      label: "章节",
    });

    (section.items || []).forEach((item, itemIndex) => {
      const itemLabel = item;
      const itemFull = item;
      const itemId = nodeId(def.id, 2, sectionIndex, itemIndex, itemFull);
      const kind = inferKind(itemLabel, itemFull, "", [], 2, section.target);
      const itemNode: KnowledgeNode = {
        id: itemId,
        name: itemLabel,
        description: "",
        chapter: def.title,
        // 关键词继承章节/网络上下文(供 matchGraphContext 关键词检索命中)
        keywords: [def.title, section.full, section.label].filter(Boolean) as string[],
        category: kind,
        resources: [],
      };
      nodes.push(itemNode);
      nodeMap.set(itemId, itemNode);
      edges.push({
        id: `${itemId}:edge`,
        source: sectionId,
        target: itemId,
        relation: "related",
        label: "知识点",
      });
    });
  });

  return { def, nodes, edges, nodeMap };
}

export function buildAllNetworks(): BuiltNetwork[] {
  return NETWORK_DEFS.map(buildNetwork);
}

export function networkToGraph(built: BuiltNetwork, progressByNode: Map<string, StudentNodeProgress>): KnowledgeGraph {
  return {
    nodes: built.nodes.map((node) => ({ ...node, progress: progressByNode.get(node.id) })),
    edges: built.edges,
    source: {
      id: built.def.id,
      title: built.def.title,
      url: `network://${built.def.id}`,
      syncedAt: new Date().toISOString(),
    },
  };
}
