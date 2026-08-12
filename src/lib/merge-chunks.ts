/**
 * 双路检索结果合并(纯函数,可单测):向量检索结果优先,关键词结果按 doc_name+内容指纹去重补充。
 * 保证提示词中的课程资料覆盖面最大化,且引用编号稳定(去重后顺序即编号)。
 */
export interface ChunkLike {
  doc_name: string;
  chapter?: string;
  content?: string;
  file_url?: string;
  similarity?: number | string;
}

/** 内容指纹:doc_name + content 前 40 字(忽略空白差异) */
function fingerprint(chunk: ChunkLike): string {
  const doc = String(chunk.doc_name || "").trim();
  const head = String(chunk.content || "").replace(/\s+/g, "").slice(0, 40);
  return `${doc}::${head}`;
}

export function mergeChunks<T extends ChunkLike>(vector: T[], keyword: T[], limit = 8): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const chunk of [...vector, ...keyword]) {
    if (!chunk || !chunk.doc_name) continue;
    const fp = fingerprint(chunk);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(chunk);
    if (out.length >= limit) break;
  }
  return out;
}
