import type { KnowledgeRelationType } from "@/types/knowledge-graph";

export const VANITAS_KNOWLEDGE_MAP_URL =
  process.env.KNOWLEDGE_GRAPH_SOURCE_URL ||
  "https://vanitasbean.github.io/knowledge-map/index_static.html";

export const VANITAS_KNOWLEDGE_MAP_ID = "vanitasbean-sponge-city-v1";
export const VANITAS_KNOWLEDGE_MAP_TITLE = "海绵城市知识图谱";

export type RemoteNodeCategory = "core" | "method" | "goal" | "factor" | "benefit";

interface RemoteNode {
  id: number;
  label: string;
  type: RemoteNodeCategory;
  description: string;
  color?: string;
  image?: string;
}

interface RemoteEdge {
  from: number;
  to: number;
}

interface RemoteGraphData {
  nodes: RemoteNode[];
  edges: RemoteEdge[];
}

export interface ImportedKnowledgeNode {
  id: string;
  name: string;
  description: string;
  chapter: string;
  keywords: string[];
  category: RemoteNodeCategory;
  color: string;
  imageUrl?: string;
  sourceUrl: string;
  sortOrder: number;
}

export interface ImportedKnowledgeEdge {
  id: string;
  source: string;
  target: string;
  relation: KnowledgeRelationType;
  label: string;
}

export interface ImportedKnowledgeMap {
  nodes: ImportedKnowledgeNode[];
  edges: ImportedKnowledgeEdge[];
}

const CATEGORY_META: Record<RemoteNodeCategory, { chapter: string; label: string; color: string }> = {
  core: { chapter: "海绵城市·核心概念", label: "核心概念", color: "#00d4ff" },
  method: { chapter: "海绵城市·技术方法", label: "技术方法", color: "#7c3aed" },
  goal: { chapter: "海绵城市·功能目标", label: "功能目标", color: "#10b981" },
  factor: { chapter: "海绵城市·影响因素", label: "影响因素", color: "#f97316" },
  benefit: { chapter: "海绵城市·效益评估", label: "效益评估", color: "#ec4899" },
};

const EXTRA_KEYWORDS: Record<string, string[]> = {
  海绵城市: ["雨洪管理", "源头减排", "自然积存", "自然渗透", "自然净化"],
  雨水管理: ["雨水收集", "雨水储存", "雨水排放", "水资源利用"],
  生态修复: ["生态系统", "水体修复", "土壤修复", "植被恢复"],
  低影响开发: ["LID", "低冲击开发", "源头控制", "分散式措施"],
  绿色基础设施: ["GI", "蓝绿空间", "基于自然的解决方案"],
  透水铺装: ["透水混凝土", "透水沥青", "透水砖"],
  雨水花园: ["生物滞留", "浅凹绿地", "径流削减"],
  生物滞留设施: ["过滤", "吸附", "微生物降解"],
  绿色屋顶: ["屋顶绿化", "种植屋面", "雨水截留"],
  下沉式绿地: ["下凹式绿地", "雨水下渗", "雨水滞留"],
  城市内涝: ["积水", "洪涝", "排水能力", "暴雨"],
  年径流总量控制率: ["径流控制", "年径流", "控制指标"],
  设计降雨量: ["设计雨量", "降雨控制值", "毫米"],
  重现期: ["暴雨频率", "设计标准", "极端降雨"],
  暴雨强度: ["降雨强度", "暴雨公式", "设计暴雨"],
  汇水面积: ["集水面积", "流域面积", "汇水区"],
};

function assertGraphData(value: unknown): asserts value is RemoteGraphData {
  if (!value || typeof value !== "object") throw new Error("远程知识地图数据格式无效");
  const graph = value as Partial<RemoteGraphData>;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !graph.nodes.length) {
    throw new Error("远程知识地图缺少节点或关系");
  }
  for (const node of graph.nodes) {
    if (
      !Number.isInteger(node?.id) ||
      typeof node?.label !== "string" ||
      typeof node?.description !== "string" ||
      !(node?.type in CATEGORY_META)
    ) {
      throw new Error("远程知识地图包含无效节点");
    }
  }
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    if (!Number.isInteger(edge?.from) || !Number.isInteger(edge?.to) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error("远程知识地图包含无效关系");
    }
  }
}

function nodeId(remoteId: number) {
  return `km-${String(remoteId).padStart(2, "0")}`;
}

function relationFor(source: RemoteNode, target: RemoteNode): KnowledgeRelationType {
  if (
    source.id === 16 ||
    source.id === 35 ||
    (source.id === 1 && [2, 3, 16].includes(target.id))
  ) {
    return "related";
  }
  return "leads_to";
}

function relationLabel(source: RemoteNode, target: RemoteNode) {
  if (source.id === 16) return "影响因素";
  if (source.id === 35) return "效益维度";
  if (source.id === 36) return "关键术语";
  if (source.id === 4 || source.id === 5) return "功能目标";
  if (target.type === "method") return "技术实现";
  if (target.type === "goal") return "建设目标";
  if (target.type === "factor") return "问题关联";
  if (target.type === "benefit") return "评估框架";
  return "知识关联";
}

function parseGraphData(html: string): RemoteGraphData {
  if (html.length > 2_000_000) throw new Error("远程知识地图页面过大");
  const match = html.match(/const\s+graphData\s*=\s*(\{[\s\S]*?\});\s*const\s+typeLabels/);
  if (!match) throw new Error("远程知识地图页面中未找到 graphData");
  const parsed: unknown = JSON.parse(match[1]);
  assertGraphData(parsed);
  return parsed;
}

export async function fetchVanitasKnowledgeMap(): Promise<ImportedKnowledgeMap> {
  const response = await fetch(VANITAS_KNOWLEDGE_MAP_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "text/html" },
  });
  if (!response.ok) throw new Error(`远程知识地图请求失败：${response.status}`);

  const remote = parseGraphData(await response.text());
  const byId = new Map(remote.nodes.map((node) => [node.id, node]));
  const sourceBase = new URL(".", VANITAS_KNOWLEDGE_MAP_URL);

  const nodes: ImportedKnowledgeNode[] = remote.nodes.map((node) => {
    const meta = CATEGORY_META[node.type];
    const keywords = Array.from(new Set([node.label, meta.label, ...(EXTRA_KEYWORDS[node.label] || [])]));
    return {
      id: nodeId(node.id),
      name: node.label.trim(),
      description: node.description.trim(),
      chapter: meta.chapter,
      keywords,
      category: node.type,
      color: node.color || meta.color,
      imageUrl: node.image
        ? new URL(`pic/${encodeURIComponent(node.image)}`, sourceBase).toString()
        : undefined,
      sourceUrl: VANITAS_KNOWLEDGE_MAP_URL,
      sortOrder: node.id,
    };
  });

  const edges: ImportedKnowledgeEdge[] = remote.edges.map((edge, index) => {
    const source = byId.get(edge.from)!;
    const target = byId.get(edge.to)!;
    return {
      id: `km-edge-${String(index + 1).padStart(2, "0")}-${edge.from}-${edge.to}`,
      source: nodeId(edge.from),
      target: nodeId(edge.to),
      relation: relationFor(source, target),
      label: relationLabel(source, target),
    };
  });

  return { nodes, edges };
}
