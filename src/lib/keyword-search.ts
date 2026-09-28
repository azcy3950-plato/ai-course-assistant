/**
 * document_chunks 关键词检索构造器(纯函数,无副作用,可单测)。
 *
 * 用于无向量 embedding 时的本地兜底检索:把问题切词后构造参数化 ILIKE 查询,
 * 按命中词数排序取前 N 条。所有用户输入只进入参数(参数化防注入),
 * 词内的 LIKE 通配符(% / _)会被转义。
 */

export interface KeywordSearchQuery {
  sql: string;
  params: string[];
}

/** 常见停用词/疑问助词:切词后长度 >= 2 且不在该集合的词才会参与检索 */
const STOP_WORDS = new Set([
  "什么", "怎么", "如何", "为什么", "哪些", "哪个", "多少", "一下",
  "可以", "请问", "帮我", "介绍", "说说", "讲讲", "这个", "那个",
  "一个", "还有", "没有", "应该", "需要", "知道", "了解",
]);

/** 从词首剥离的疑问/引导词(循环剥离,如「什么是海绵城市」→「海绵城市」、「我想了解透水铺装」→「透水铺装」) */
const HEAD_STOP = ["什么是", "为什么", "我想了解", "想了解", "怎么", "什么", "如何", "哪些", "哪个", "请问", "帮我", "给我", "介绍一下", "介绍", "说说", "讲讲", "说一下", "说下", "可以", "应该", "需要", "了解", "知道", "是", "有", "我想", "我要"];

/** 从词尾剥离的助词/常见后缀(如「渗透铺装如何工作」→「渗透铺装」) */
const TAIL_STOP = ["一下", "如何", "怎么", "什么", "可以", "应该", "需要", "工作", "使用", "处理", "建设", "的", "了", "吗", "呢", "啊", "吧"];

/** 中文/英文标点与空白分隔符 */
const SPLIT_RE = /[，。！？、；：,.!?;:\s\n\r"'“”‘’（）()【】\[\]《》<>/\\\-—–]+/;

function trimStop(t: string): string {
  let out = t;
  for (let i = 0; i < 8; i++) {
    let changed = false;
    for (const w of HEAD_STOP) {
      if (out.startsWith(w) && out.length > w.length) { out = out.slice(w.length); changed = true; break; }
    }
    for (const w of TAIL_STOP) {
      if (out.endsWith(w) && out.length > w.length) { out = out.slice(0, out.length - w.length); changed = true; break; }
    }
    if (!changed) break;
  }
  return out;
}

function escapeLike(word: string): string {
  return word.replace(/[\\%_]/g, (ch) => "\\" + ch);
}

export function buildKeywordSearch(question: string, limit = 6): KeywordSearchQuery {
  // 防滥用:问题截断 200 字,参与检索的词数上限 8(每个词一条 OR 分支,超限会全表扫描)
  const safeQuestion = String(question || "").slice(0, 200);
  const safeLimit = Math.max(1, Math.min(20, Math.floor(Number(limit) || 6)));
  const seen = new Set<string>();
  const words: string[] = [];
  const pushWord = (w: string) => {
    if (words.length >= 8) return; // 早退防滥用:每 token 多段时也封顶 8 词
    if (w.length < 2 || STOP_WORDS.has(w) || seen.has(w)) return;
    seen.add(w);
    words.push(w);
  };
  for (const token of safeQuestion.split(SPLIT_RE)) {
    const t = trimStop(token.trim());
    if (!t) continue;
    // 中英边界再切词:文档中「LID 设施」带空格,而提问「LID设施」不带 → 拆成 LID + 设施,提高混合术语命中
    const parts = t.split(/(?<=[\u4e00-\u9fff])(?=[a-zA-Z0-9])|(?<=[a-zA-Z0-9])(?=[\u4e00-\u9fff])/);
    if (parts.length > 1) {
      for (const p of parts) pushWord(p.trim());
    } else {
      pushWord(t);
    }
    if (words.length >= 8) break;
  }

  // 无有效词:退化为按最近入库取前 N 条(仍来自知识库,而非图谱数据)
  if (words.length === 0) {
    return {
      sql: "SELECT doc_name, chapter, content, file_url, 0 AS hit_score FROM document_chunks ORDER BY id DESC LIMIT " + safeLimit,
      params: [],
    };
  }

  const conds = words.map((_, i) => `(content ILIKE $${i + 1} OR doc_name ILIKE $${i + 1} OR chapter ILIKE $${i + 1})`);
  const scores = words
    .map((_, i) => `(CASE WHEN content ILIKE $${i + 1} THEN 1 ELSE 0 END) + (CASE WHEN doc_name ILIKE $${i + 1} THEN 1 ELSE 0 END) + (CASE WHEN chapter ILIKE $${i + 1} THEN 1 ELSE 0 END)`)
    .join(" + ");

  return {
    sql: `SELECT doc_name, chapter, content, file_url, (${scores}) AS hit_score
FROM document_chunks
WHERE ${conds.join(" OR ")}
ORDER BY hit_score DESC, content
LIMIT ${safeLimit}`,
    params: words.map((w) => `%${escapeLike(w)}%`),
  };
}
