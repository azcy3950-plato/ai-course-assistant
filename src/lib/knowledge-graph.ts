import { Pool, type PoolClient } from "pg";
import type {
  GraphContext,
  KnowledgeEdge,
  KnowledgeGraph,
  KnowledgeNode,
  KnowledgeRelationType,
  KnowledgeResource,
  StudentNodeProgress,
} from "@/types/knowledge-graph";
import {
  fetchVanitasKnowledgeMap,
  VANITAS_KNOWLEDGE_MAP_ID,
  VANITAS_KNOWLEDGE_MAP_TITLE,
  VANITAS_KNOWLEDGE_MAP_URL,
} from "@/lib/vanitas-knowledge-map";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const LEGACY_SEED_NODE_IDS = [
  "intro",
  "drain",
  "runoff",
  "storm",
  "design-flow",
  "flood",
  "sponge",
  "lid",
  "green",
  "swmm",
  "gis-risk",
  "resilience",
  "cases",
  "policy",
];

let schemaReady: Promise<void> | null = null;

async function setMeta(client: PoolClient, key: string, value: string) {
  await client.query(
    `INSERT INTO knowledge_graph_meta (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

async function syncRemoteKnowledgeMap() {
  let imported;
  try {
    imported = await fetchVanitasKnowledgeMap();
  } catch (error) {
    const cached = await pool.query(
      "SELECT count(*)::int AS count FROM knowledge_graph_nodes WHERE source_url = $1",
      [VANITAS_KNOWLEDGE_MAP_URL],
    );
    if (Number(cached.rows[0]?.count || 0) > 0) {
      console.warn("远程知识地图暂时不可用，继续使用数据库缓存", error);
      return;
    }
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const activeSource = await client.query(
      "SELECT value FROM knowledge_graph_meta WHERE key = 'active_source'",
    );
    if (activeSource.rows[0]?.value !== VANITAS_KNOWLEDGE_MAP_ID) {
      await client.query("DELETE FROM knowledge_graph_nodes WHERE id = ANY($1::text[])", [LEGACY_SEED_NODE_IDS]);
    }

    for (const node of imported.nodes) {
      await client.query(
        `INSERT INTO knowledge_graph_nodes
           (id, name, description, chapter, keywords, category, color, image_url, source_url, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           embedding = CASE
             WHEN knowledge_graph_nodes.name IS DISTINCT FROM EXCLUDED.name
               OR knowledge_graph_nodes.description IS DISTINCT FROM EXCLUDED.description
               OR knowledge_graph_nodes.keywords IS DISTINCT FROM EXCLUDED.keywords
             THEN NULL
             ELSE knowledge_graph_nodes.embedding
           END,
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           chapter = EXCLUDED.chapter,
           keywords = EXCLUDED.keywords,
           category = EXCLUDED.category,
           color = EXCLUDED.color,
           image_url = EXCLUDED.image_url,
           source_url = EXCLUDED.source_url,
           sort_order = EXCLUDED.sort_order,
           updated_at = now()`,
        [
          node.id,
          node.name,
          node.description,
          node.chapter,
          node.keywords,
          node.category,
          node.color,
          node.imageUrl || null,
          node.sourceUrl,
          node.sortOrder,
        ],
      );
    }

    const nodeIds = imported.nodes.map((node) => node.id);
    await client.query(
      "DELETE FROM knowledge_graph_nodes WHERE source_url = $1 AND NOT (id = ANY($2::text[]))",
      [VANITAS_KNOWLEDGE_MAP_URL, nodeIds],
    );

    for (const edge of imported.edges) {
      await client.query(
        `INSERT INTO knowledge_graph_edges (id, source, target, relation, label, origin)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           source = EXCLUDED.source,
           target = EXCLUDED.target,
           relation = EXCLUDED.relation,
           label = EXCLUDED.label,
           origin = EXCLUDED.origin`,
        [edge.id, edge.source, edge.target, edge.relation, edge.label, VANITAS_KNOWLEDGE_MAP_ID],
      );
    }
    const edgeIds = imported.edges.map((edge) => edge.id);
    await client.query(
      "DELETE FROM knowledge_graph_edges WHERE origin = $1 AND NOT (id = ANY($2::text[]))",
      [VANITAS_KNOWLEDGE_MAP_ID, edgeIds],
    );

    for (const node of imported.nodes) {
      const resourceId = `source-${node.id}`;
      await client.query(
        `INSERT INTO knowledge_graph_resources
           (id, node_id, resource_type, title, doc_name, chapter, file_url, snippet, origin)
         VALUES ($1,$2,'reference',$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           node_id = EXCLUDED.node_id,
           resource_type = EXCLUDED.resource_type,
           title = EXCLUDED.title,
           doc_name = EXCLUDED.doc_name,
           chapter = EXCLUDED.chapter,
           file_url = EXCLUDED.file_url,
           snippet = EXCLUDED.snippet,
           origin = EXCLUDED.origin`,
        [
          resourceId,
          node.id,
          `${node.name}｜原始知识地图`,
          VANITAS_KNOWLEDGE_MAP_TITLE,
          node.chapter,
          VANITAS_KNOWLEDGE_MAP_URL,
          node.description,
          VANITAS_KNOWLEDGE_MAP_ID,
        ],
      );
    }
    const resourceIds = imported.nodes.map((node) => `source-${node.id}`);
    await client.query(
      "DELETE FROM knowledge_graph_resources WHERE origin = $1 AND NOT (id = ANY($2::text[]))",
      [VANITAS_KNOWLEDGE_MAP_ID, resourceIds],
    );

    await setMeta(client, "active_source", VANITAS_KNOWLEDGE_MAP_ID);
    await setMeta(client, "source_title", VANITAS_KNOWLEDGE_MAP_TITLE);
    await setMeta(client, "source_url", VANITAS_KNOWLEDGE_MAP_URL);
    await setMeta(client, "source_synced_at", new Date().toISOString());
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function ensureKnowledgeGraphSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector").catch(() => undefined);
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
    `);
    await pool.query("ALTER TABLE knowledge_graph_nodes ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'core'");
    await pool.query("ALTER TABLE knowledge_graph_nodes ADD COLUMN IF NOT EXISTS color text");
    await pool.query("ALTER TABLE knowledge_graph_nodes ADD COLUMN IF NOT EXISTS image_url text");
    await pool.query("ALTER TABLE knowledge_graph_nodes ADD COLUMN IF NOT EXISTS source_url text");
    await pool.query("ALTER TABLE knowledge_graph_nodes ADD COLUMN IF NOT EXISTS sort_order integer");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
        id text PRIMARY KEY,
        source text NOT NULL REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
        target text NOT NULL REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
        relation text NOT NULL,
        label text NOT NULL,
        origin text
      )
    `);
    await pool.query("ALTER TABLE knowledge_graph_edges ADD COLUMN IF NOT EXISTS origin text");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge_graph_resources (
        id text PRIMARY KEY,
        node_id text NOT NULL REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
        resource_type text NOT NULL,
        title text NOT NULL,
        doc_name text NOT NULL,
        chapter text NOT NULL DEFAULT '',
        page integer,
        file_url text,
        snippet text,
        origin text
      )
    `);
    await pool.query("ALTER TABLE knowledge_graph_resources ADD COLUMN IF NOT EXISTS origin text");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_node_progress (
        user_email text NOT NULL,
        node_id text NOT NULL REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
        question_count integer NOT NULL DEFAULT 0,
        study_count integer NOT NULL DEFAULT 0,
        quiz_correct integer NOT NULL DEFAULT 0,
        quiz_total integer NOT NULL DEFAULT 0,
        last_studied_at timestamptz,
        mastery numeric(5,2) NOT NULL DEFAULT 0,
        PRIMARY KEY (user_email, node_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge_graph_meta (
        key text PRIMARY KEY,
        value text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await syncRemoteKnowledgeMap();
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

export async function loadKnowledgeGraph(userEmail = ""): Promise<KnowledgeGraph> {
  await ensureKnowledgeGraphSchema();
  const [nodeResult, edgeResult, resourceResult, progressResult, metaResult] = await Promise.all([
    pool.query(
      `SELECT id, name, description, chapter, keywords, category, color, image_url, source_url
       FROM knowledge_graph_nodes
       ORDER BY sort_order NULLS LAST, id`,
    ),
    pool.query("SELECT id, source, target, relation, label FROM knowledge_graph_edges ORDER BY id"),
    pool.query("SELECT * FROM knowledge_graph_resources ORDER BY id"),
    userEmail
      ? pool.query("SELECT * FROM student_node_progress WHERE user_email = $1", [userEmail])
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    pool.query(
      "SELECT key, value FROM knowledge_graph_meta WHERE key IN ('active_source','source_title','source_url','source_synced_at')",
    ),
  ]);

  const resourcesByNode = new Map<string, KnowledgeResource[]>();
  for (const row of resourceResult.rows) {
    const resource: KnowledgeResource = {
      id: row.id,
      nodeId: row.node_id,
      type: row.resource_type,
      title: row.title,
      docName: row.doc_name,
      chapter: row.chapter,
      page: row.page ?? undefined,
      url: row.file_url || undefined,
      snippet: row.snippet || undefined,
    };
    resourcesByNode.set(row.node_id, [...(resourcesByNode.get(row.node_id) || []), resource]);
  }

  const progressByNode = new Map(progressResult.rows.map((row) => [String(row.node_id), mapProgress(row)]));
  const nodes: KnowledgeNode[] = nodeResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    chapter: row.chapter,
    keywords: row.keywords || [],
    category: row.category,
    color: row.color || undefined,
    imageUrl: row.image_url || undefined,
    sourceUrl: row.source_url || undefined,
    resources: resourcesByNode.get(row.id) || [],
    progress: progressByNode.get(row.id),
  }));
  const edges: KnowledgeEdge[] = edgeResult.rows.map((row) => ({
    id: row.id,
    source: row.source,
    target: row.target,
    relation: row.relation as KnowledgeRelationType,
    label: row.label,
  }));

  const meta = new Map(metaResult.rows.map((row) => [String(row.key), String(row.value)]));
  const sourceUrl = meta.get("source_url");
  const source = sourceUrl
    ? {
        id: meta.get("active_source") || VANITAS_KNOWLEDGE_MAP_ID,
        title: meta.get("source_title") || VANITAS_KNOWLEDGE_MAP_TITLE,
        url: sourceUrl,
        syncedAt: meta.get("source_synced_at"),
      }
    : undefined;
  return { nodes, edges, source };
}

export async function getNodesWithoutEmbeddings(): Promise<Array<{ id: string; text: string }>> {
  await ensureKnowledgeGraphSchema();
  const { rows } = await pool.query(
    "SELECT id, name, description, keywords FROM knowledge_graph_nodes WHERE embedding IS NULL ORDER BY sort_order NULLS LAST, id",
  );
  return rows.map((row) => ({ id: row.id, text: `${row.name}。${row.description}。${(row.keywords || []).join("、")}` }));
}

export async function storeNodeEmbeddings(items: Array<{ id: string; embedding: number[] }>) {
  if (!items.length) return;
  await ensureKnowledgeGraphSchema();
  for (const item of items) {
    await pool.query(
      "UPDATE knowledge_graph_nodes SET embedding = $2::vector, updated_at = now() WHERE id = $1 AND embedding IS NULL",
      [item.id, `[${item.embedding.join(",")}]`],
    );
  }
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

export async function matchGraphContext(
  question: string,
  questionEmbedding: number[] | undefined,
  chunks: Array<{ doc_name?: string; chapter?: string; content?: string; similarity?: number }> = [],
  userEmail = "",
): Promise<GraphContext> {
  const graph = await loadKnowledgeGraph(userEmail);
  if (!graph.nodes.length) throw new Error("知识图谱数据库中没有可用节点");

  const embeddingScores = new Map<string, number>();
  if (questionEmbedding?.length) {
    const vector = `[${questionEmbedding.join(",")}]`;
    const { rows } = await pool.query(
      "SELECT id, GREATEST(0, 1 - (embedding <=> $1::vector)) AS similarity FROM knowledge_graph_nodes WHERE embedding IS NOT NULL",
      [vector],
    );
    rows.forEach((row) => embeddingScores.set(row.id, Number(row.similarity || 0)));
  }

  const lowerQuestion = question.toLowerCase();
  const scored = graph.nodes.map((node) => {
    const terms = [node.name, ...node.keywords].map((term) => term.toLowerCase());
    const matches = terms.filter((term) => term && lowerQuestion.includes(term)).length;
    const keywordScore = Math.min(
      1,
      matches / Math.max(1, Math.min(3, terms.length)) +
        (lowerQuestion.includes(node.name.toLowerCase()) ? 0.45 : 0),
    );
    const documentScore = chunks.reduce((best, chunk) => {
      const chunkText = `${chunk.doc_name || ""} ${chunk.chapter || ""} ${chunk.content || ""}`.toLowerCase();
      const matchesResource = node.resources.some(
        (resource) =>
          resource.docName === chunk.doc_name &&
          (!chunk.chapter ||
            !resource.chapter ||
            resource.chapter.includes(chunk.chapter) ||
            chunk.chapter.includes(resource.chapter)),
      );
      const mentionsNode = [node.name, ...node.keywords].some(
        (term) => term.length >= 2 && chunkText.includes(term.toLowerCase()),
      );
      return matchesResource || mentionsNode ? Math.max(best, Number(chunk.similarity || 0)) : best;
    }, 0);
    const embeddingScore = embeddingScores.get(node.id) || 0;
    return {
      node,
      keywordScore,
      embeddingScore,
      documentScore,
      combinedScore: keywordScore * 0.4 + embeddingScore * 0.35 + documentScore * 0.25,
    };
  }).sort((a, b) => b.combinedScore - a.combinedScore || b.keywordScore - a.keywordScore);

  const best = scored[0].combinedScore > 0
    ? scored[0]
    : (scored.find((candidate) => candidate.node.id === "km-01") || scored[0]);
  const focusNode = best.node;
  const { prerequisites, related, next, edgeIds } = neighborsFor(focusNode.id, graph);
  const suggestedPool = [...next, ...related, focusNode];
  const suggestedNextNode = suggestedPool.sort(
    (a, b) => (a.progress?.mastery || 0) - (b.progress?.mastery || 0),
  )[0];
  return {
    focusNode,
    prerequisites,
    relatedNodes: related,
    nextNodes: next,
    highlightNodeIds: [
      focusNode.id,
      ...prerequisites.map((node) => node.id),
      ...related.map((node) => node.id),
      ...next.map((node) => node.id),
    ],
    highlightEdges: edgeIds,
    suggestedNextNode,
    matchSignals: {
      keywordScore: best.keywordScore,
      embeddingScore: best.embeddingScore,
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
  const { rows } = await pool.query(
    `INSERT INTO student_node_progress
       (user_email, node_id, question_count, study_count, last_studied_at)
     VALUES ($1,$2,$3,1,now())
     ON CONFLICT (user_email, node_id) DO UPDATE SET
       question_count = student_node_progress.question_count + $3,
       study_count = student_node_progress.study_count + 1,
       last_studied_at = now()
     RETURNING *`,
    [userEmail, nodeId, questionIncrement],
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
  const graph = await loadKnowledgeGraph(userEmail);
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
  const preferred = [
    "km-01",
    "km-02",
    "km-16",
    "km-04",
    "km-37",
    "km-06",
    "km-38",
    "km-07",
    "km-05",
    "km-35",
    "km-36",
  ];
  const existing = new Set(graph.nodes.map((node) => node.id));
  return preferred.filter((id) => existing.has(id));
}
