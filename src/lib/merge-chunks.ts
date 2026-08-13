/**
 * 双路检索结果融合(纯函数,可单测):RRF(Reciprocal Rank Fusion)重排——
 * 每路结果按各自排名计分 score = Σ 1/(60 + rank),跨路同文档累加,按总分降序取前 N。
 * 向量路(按相似度排)与关键词路(按命中分排)融合,兼顾语义与关键词精确命中。
 */
export interface ChunkLike {
  doc_name: string;
  chapter?: string;
  content?: string;
  file_url?: string;
  similarity?: number | string;
}

/** 内容指纹:doc_name + content 前 40 字 + 内容总长(避免相同前缀的不同 chunk 被误并) */
function fingerprint(chunk: ChunkLike): string {
  const doc = String(chunk.doc_name || "").trim();
  const content = String(chunk.content || "");
  const head = content.replace(/\s+/g, "").slice(0, 40);
  return `${doc}::${head}::${content.length}`;
}

const RRF_K = 60;

export function mergeChunks<T extends ChunkLike>(vector: T[], keyword: T[], limit = 8): T[] {
  const scores = new Map<string, { chunk: T; score: number }>();
  const addList = (list: T[]) => {
    list.forEach((chunk, idx) => {
      if (!chunk || !chunk.doc_name) return;
      const fp = fingerprint(chunk);
      const score = 1 / (RRF_K + idx + 1);
      const cur = scores.get(fp);
      if (cur) {
        cur.score += score;
        // 保留更完整的一条(有 similarity 优先)
        if (cur.chunk.similarity === undefined && chunk.similarity !== undefined) cur.chunk = chunk;
      } else {
        scores.set(fp, { chunk, score });
      }
    });
  };
  addList(vector);
  addList(keyword);
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(20, Math.floor(Number(limit) || 8))))
    .map((entry) => entry.chunk);
}
