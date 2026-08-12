import { Pool } from "pg";
import type {
  GraphContext,
  KnowledgeEdge,
  KnowledgeGraph,
  KnowledgeNode,
  KnowledgeRelationType,
  KnowledgeResource,
  StudentNodeProgress,
} from "../types/knowledge-graph";
import { buildAllNetworks, networkToGraph, type BuiltNetwork } from "./knowledge-map-builder";
import { NETWORK_DEFS } from "./knowledge-map-data";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let schemaReady: Promise<void> | null = null;

// 学习进度表(student_node_progress)外键指向旧节点表;新图谱节点不落库,去掉外键约束
export function ensureKnowledgeGraphSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
        id text PRIMARY KEY,
        name text NOT NULL UNIQUE,
        description text NOT NULL,
        chapter text NOT NULL,
        keywords text[] NOT NULL DEFAULT '{}',
        embedding vector,
        category text NOT NULL DEFAULT 'core',
        color text,
        image_url text,
        source_url text,
        sort_order integer,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `).catch(() => undefined);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_node_progress (
        user_email text NOT NULL,
        node_id text NOT NULL,
        question_count integer NOT NULL DEFAULT 0,
        study_count integer NOT NULL DEFAULT 0,
        quiz_correct integer NOT NULL DEFAULT 0,
        quiz_total integer NOT NULL DEFAULT 0,
        last_studied_at timestamptz,
        mastery numeric(5,2) NOT NULL DEFAULT 0,
        PRIMARY KEY (user_email, node_id)
      )
    `);
    await pool.query("ALTER TABLE student_node_progress DROP CONSTRAINT IF EXISTS student_node_progress_node_id_fkey").catch(() => undefined);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function mapProgress(row: Record<string, unknown>): StudentNodeProgress {
  const quizTotal = Number(row.quiz_total || 0);
  const quizCorrect = Number(row.quiz_correct || 0);
  return {
    nodeId: String(row.node_id),
    questionCount: Number(row.question_count || 0),
    studyCount: Number(row.study_count || 0),
    quizCorrect,
    quizTotal,
    quizAccuracy: quizTotal ? Math.round((quizCorrect / quizTotal) * 100) : 0,
    lastStudiedAt: row.last_studied_at ? new Date(String(row.last_studied_at)).toISOString() : undefined,
    mastery: Math.round(Number(row.mastery || 0)),
  };
}

export function listNetworks() {
  return NETWORK_DEFS.map((d) => ({
    id: d.id,
    chip: d.chip,
    title: d.title,
    subtitle: d.subtitle,
    summary: d.summary,
    source: d.source,
    pages: d.pages,
    sections: d.sections.map((s) => ({ label: s.label, full: s.full, target: s.target || null })),
  }));
}

export async function loadKnowledgeGraph(userEmail = "", networkId = "overview"): Promise<KnowledgeGraph> {
  await ensureKnowledgeGraphSchema();
  let progressRows: Record<string, unknown>[] = [];
  if (userEmail) {
    const res = await pool.query("SELECT * FROM student_node_progress WHERE user_email = $1", [userEmail]);
    progressRows = res.rows as Record<string, unknown>[];
  }
  const progressByNode = new Map(progressRows.map((row) => [String(row.node_id), mapProgress(row)]));
  if (networkId === "all") {
    const all = buildAllNetworks();
    return {
      nodes: all.flatMap((n) => n.nodes).map((node) => ({ ...node, progress: progressByNode.get(node.id) })),
      edges: all.flatMap((n) => n.edges),
      source: { id: "all", title: "基础设施规划知识图谱(8 网络)", url: "network://all" },
    };
  }
  const built = buildAllNetworks().find((n) => n.def.id === networkId) || buildAllNetworks()[0];
  return networkToGraph(built, progressByNode);
}

export async function getNodesWithoutEmbeddings(): Promise<Array<{ id: string; text: string }>> {
  // 新图谱节点不落库:返回全部节点文本供向量化(embedding 服务端可选)
  const all = buildAllNetworks();
  return all.flatMap((n) => n.nodes).map((node) => ({ id: node.id, text: `${node.name}。${node.description}。${node.keywords.join("、")}` }));
}

export async function storeNodeEmbeddings(items: Array<{ id: string; embedding: number[] }>) {
  // 新图谱节点不落库,embedding 向量检索由关键词匹配兜底,此处空实现保留接口
  void items;
}

function neighborsFor(
  focusId: string,
  graph: KnowledgeGraph,
): { prerequisites: KnowledgeNode[]; related: KnowledgeNode[]; next: KnowledgeNode[]; edgeIds: string[] } {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const prerequisiteIds = new Set<string>();
  const relatedIds = new Set<string>();
  const nextIds = new Set<string>();
  const edgeIds: string[] = [];
  for (const edge of graph.edges) {
    if (edge.source !== focusId && edge.target !== focusId) continue;
    edgeIds.push(edge.id);
    if (["related", "applied_in", "governed_by"].includes(edge.relation)) {
      relatedIds.add(edge.source === focusId ? edge.target : edge.source);
    } else if (edge.target === focusId) {
      prerequisiteIds.add(edge.source);
    } else {
      nextIds.add(edge.target);
    }
  }
  const resolve = (ids: Set<string>) =>
    [...ids].map((id) => byId.get(id)).filter((node): node is KnowledgeNode => Boolean(node));
  return { prerequisites: resolve(prerequisiteIds), related: resolve(relatedIds), next: resolve(nextIds), edgeIds };
}

// 全 8 网络合并图(供跨网络语义匹配/题目关联使用)
function allNetworksGraph(): KnowledgeGraph {
  const all = buildAllNetworks();
  return {
    nodes: all.flatMap((n) => n.nodes),
    edges: all.flatMap((n) => n.edges),
    source: { id: "all", title: "基础设施规划知识图谱(8 网络)", url: "network://all" },
  };
}

export async function matchGraphContext(
  question: string,
  _questionEmbedding: number[] | undefined,
  chunks: Array<{ doc_name?: string; chapter?: string; content?: string; similarity?: number }> = [],
  userEmail = "",
): Promise<GraphContext> {
  const graph = allNetworksGraph();
  if (!graph.nodes.length) throw new Error("知识图谱数据库中没有可用节点");

  const lowerQuestion = question.toLowerCase();
  const scored = graph.nodes.map((node) => {
    // 匹配词表:名称 + 关键词(含章节/网络上下文) + 章节名;item 节点继承章节上下文
    const terms = [node.name, ...node.keywords, node.chapter].map((term) => term.toLowerCase()).filter((term) => term.length >= 2);
    const matches = terms.filter((term) => term && lowerQuestion.includes(term)).length;
    const keywordScore = Math.min(
      1,
      matches / Math.max(1, Math.min(3, terms.length)) +
        (lowerQuestion.includes(node.name.toLowerCase()) ? 0.45 : 0),
    );
    const documentScore = chunks.reduce((best, chunk) => {
      const chunkText = `${chunk.doc_name || ""} ${chunk.chapter || ""} ${chunk.content || ""}`.toLowerCase();
      const mentionsNode = [node.name, ...node.keywords].some(
        (term) => term.length >= 2 && chunkText.includes(term.toLowerCase()),
      );
      return mentionsNode ? Math.max(best, Number(chunk.similarity || 0)) : best;
    }, 0);
    return {
      node,
      keywordScore,
      documentScore,
      combinedScore: keywordScore * 0.6 + documentScore * 0.4,
    };
  }).sort((a, b) => b.combinedScore - a.combinedScore || b.keywordScore - a.keywordScore);

  const best = scored[0].combinedScore > 0
    ? scored[0]
    : (scored.find((candidate) => candidate.node.category === "core") || scored[0]);
  const focusNode = best.node;
  const { prerequisites, related, next, edgeIds } = neighborsFor(focusNode.id, graph);
  // 命中章节(category)节点时,联动其 items(叶子知识点)一起高亮,让图谱上下文更聚焦
  const highlightIds = [focusNode.id, ...prerequisites.map((node) => node.id), ...related.map((node) => node.id), ...next.map((node) => node.id)];
  if (focusNode.category === "category") {
    graph.edges.filter((e) => e.source === focusNode.id).forEach((e) => {
      highlightIds.push(e.target);
      edgeIds.push(e.id);
    });
  }
  const suggestedPool = [...next, ...related, focusNode];
  const suggestedNextNode = suggestedPool.sort(
    (a, b) => (a.progress?.mastery || 0) - (b.progress?.mastery || 0),
  )[0];
  return {
    focusNode,
    prerequisites,
    relatedNodes: related,
    nextNodes: next,
    highlightNodeIds: highlightIds,
    highlightEdges: edgeIds,
    suggestedNextNode,
    matchSignals: {
      keywordScore: best.keywordScore,
      embeddingScore: 0,
      documentScore: best.documentScore,
      combinedScore: best.combinedScore,
    },
  };
}

export async function recordNodeInteraction(
  userEmail: string,
  nodeId: string,
  kind: "question" | "study" = "study",
): Promise<StudentNodeProgress | undefined> {
  if (!userEmail || !nodeId) return undefined;
  await ensureKnowledgeGraphSchema();
  const questionIncrement = kind === "question" ? 1 : 0;
  const studyIncrement = kind === "study" ? 1 : 0;
  const { rows } = await pool.query(
    `INSERT INTO student_node_progress
       (user_email, node_id, question_count, study_count, last_studied_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (user_email, node_id) DO UPDATE SET
       question_count = student_node_progress.question_count + $3,
       study_count = student_node_progress.study_count + $4,
       last_studied_at = now()
     RETURNING *`,
    [userEmail, nodeId, questionIncrement, studyIncrement],
  );
  const row = rows[0];
  if (!row) return undefined;
  const engagement = Math.min(40, Number(row.question_count) * 3 + Number(row.study_count) * 2);
  const quizScore = Number(row.quiz_total) > 0
    ? (Number(row.quiz_correct) / Number(row.quiz_total)) * 60
    : 0;
  const mastery = Math.min(100, engagement + quizScore);
  const updated = await pool.query(
    "UPDATE student_node_progress SET mastery = $3 WHERE user_email = $1 AND node_id = $2 RETURNING *",
    [userEmail, nodeId, mastery],
  );
  return mapProgress(updated.rows[0]);
}

export async function recordQuizResultByTopic(userEmail: string, topic: string, isCorrect: boolean) {
  if (!userEmail || !topic) return undefined;
  const graph = allNetworksGraph();
  const normalized = topic.toLowerCase();
  const node = graph.nodes.find(
    (candidate) => candidate.id.toLowerCase() === normalized || candidate.name.toLowerCase() === normalized,
  ) || graph.nodes.find((candidate) =>
    candidate.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
  );
  if (!node) return undefined;
  await pool.query(
    `INSERT INTO student_node_progress
       (user_email, node_id, quiz_correct, quiz_total, last_studied_at)
     VALUES ($1,$2,$3,1,now())
     ON CONFLICT (user_email, node_id) DO UPDATE SET
       quiz_correct = student_node_progress.quiz_correct + $3,
       quiz_total = student_node_progress.quiz_total + 1,
       last_studied_at = now()`,
    [userEmail, node.id, isCorrect ? 1 : 0],
  );
  return recordNodeInteraction(userEmail, node.id, "study");
}

export function buildSuggestedPath(graph: KnowledgeGraph): string[] {
  // 学习建议路径:总览 root → 各专题网络 root(按课程顺序)
  const order = ["overview", "general", "water", "drainage", "wastewater", "sponge", "power", "resilience"];
  const byNetwork = new Map(buildAllNetworks().map((n) => [n.def.id, n]));
  const path: string[] = [];
  for (const id of order) {
    const built = byNetwork.get(id);
    if (!built) continue;
    const root = built.nodes.find((n) => n.category === "core");
    if (root) path.push(root.id);
    if (id === graph.nodes[0]?.id && graph.nodes.length > 1) break;
  }
  return path;
}

// 兼容旧导出(embedding 相关接口保留签名)
export type { KnowledgeGraph, KnowledgeEdge, KnowledgeNode, KnowledgeResource, KnowledgeRelationType };
