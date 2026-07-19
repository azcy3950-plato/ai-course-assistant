const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!;
const DEEPSEEK_MODEL = "deepseek-chat";
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

// ── Call DeepSeek chat ──
async function callDeepSeek(messages: ChatMsg[], maxTokens = 2048) {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek 错误 (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── Call DashScope embedding ──
async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "text-embedding-v2",
        input: text,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding 错误: ${err}`);
  }
  const data = await res.json();
  return data.data?.[0]?.embedding;
}

// ── Vector search in Supabase ──
async function searchChunks(embedding: number[], topK = 5) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_chunks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      query_embedding: embedding,
      match_count: topK,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Search error:", err);
    return [];
  }
  return res.json();
}

// ── Seed: store a chunk in Supabase ──
async function storeChunk(
  docName: string,
  chapter: string,
  content: string,
  embedding: number[]
) {
  await fetch(`${SUPABASE_URL}/rest/v1/document_chunks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      doc_name: docName,
      chapter,
      content,
      embedding,
    }),
  });
}

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "未登录" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const { action, params } = await req.json();
    let messages: ChatMsg[];

    // ══════════════ KNOWLEDGE AGENT (with vector RAG) ══════════════
    if (action === "knowledge") {
      const { question } = params;

      // 1) Vector search
      let contextBlock = "";
      try {
        const qEmbedding = await getEmbedding(question);
        if (qEmbedding) {
          const chunks = await searchChunks(qEmbedding, 5);
          if (chunks.length > 0) {
            contextBlock =
              "\n\n以下是知识库中与问题最相关的资料片段：\n\n" +
              chunks
                .map(
                  (c: any, i: number) =>
                    `[${c.doc_name}${c.chapter ? " " + c.chapter : ""} 相似度:${(c.similarity * 100).toFixed(0)}%]\n${c.content}`
                )
                .join("\n\n") +
              "\n\n请基于以上资料回答。如果资料不完整可以补充你的知识，但优先使用资料中的内容。";
          }
        }
      } catch (e) {
        console.error("向量搜索失败:", e);
      }

      messages = [
        {
          role: "system",
          content: `你是「城市排水与内涝防治」课程的 AI 助教。用中文回答，专业清晰，引用资料时标注出处。${contextBlock}`,
        },
        { role: "user", content: question },
      ];

      const answer = await callDeepSeek(messages);
      return new Response(
        JSON.stringify({ answer, references: [] }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ══════════════ SEED: 向量化存储知识库片段 ══════════════
    if (action === "seed_chunk") {
      const { docName, chapter, content } = params;
      const embedding = await getEmbedding(content);
      await storeChunk(docName, chapter || "", content, embedding);
      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ══════════════ CLEAR chunks ══════════════
    if (action === "clear_chunks") {
      await fetch(`${SUPABASE_URL}/rest/v1/document_chunks`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({}),
      });
      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ══════════════ GUIDED — START ══════════════
    if (action === "guided_start") {
      const { scenarioTitle, scenarioDescription, firstQuestion, totalSteps } =
        params;
      messages = [
        {
          role: "system",
          content: "你是引导式学习 AI 助教。用中文，亲切鼓励。",
        },
        {
          role: "user",
          content: `学习场景「${scenarioTitle}」：${scenarioDescription}\n第一个问题：${firstQuestion}\n共 ${totalSteps} 步。请生成简短欢迎语然后自然引出问题。直接说人话。`,
        },
      ];
      const text = await callDeepSeek(messages, 512);
      return new Response(
        JSON.stringify({ greeting: text, firstQuestion }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ══════════════ GUIDED — EVALUATE ══════════════
    if (action === "guided_evaluate") {
      const {
        scenarioTitle, stepNumber, totalSteps,
        question, expectedAnswer, studentAnswer,
      } = params;
      messages = [
        {
          role: "system",
          content: `你评价学生在「${scenarioTitle}」中的回答。鼓励为主，指出可补充处。输出JSON: {"feedback":"评价","explanation":"知识讲解"}`,
        },
        {
          role: "user",
          content: `问题(${stepNumber}/${totalSteps}): ${question}\n${expectedAnswer ? "参考要点:" + expectedAnswer : ""}\n学生回答: ${studentAnswer}`,
        },
      ];
      const text = await callDeepSeek(messages, 1024);
      try {
        const p = JSON.parse(text);
        return new Response(
          JSON.stringify({ feedback: p.feedback, explanation: p.explanation }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } catch {
        return new Response(
          JSON.stringify({ feedback: text, explanation: text }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // ══════════════ GUIDED — HINT ══════════════
    if (action === "guided_hint") {
      const { question, hintsUsed } = params;
      messages = [
        {
          role: "system",
          content: "逐级提示。1=方向,2=思路,3=步骤,4+=接近答案。直接说人话。",
        },
        {
          role: "user",
          content: `问题: ${question}\n已用${hintsUsed}次提示，给第${hintsUsed + 1}级。`,
        },
      ];
      const text = await callDeepSeek(messages, 256);
      return new Response(
        JSON.stringify({ hint: text }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ══════════════ SANDBOX ══════════════
    if (action === "sandbox") {
      const { question, simulation } = params;
      messages = [
        {
          role: "system",
          content: "城市排水与内涝防治专家。分析模拟数据，给出专业建议。中文，清晰。",
        },
        {
          role: "user",
          content: `降雨强度${simulation?.intensity || "?"}mm/h，历时${simulation?.duration || "?"}min，积水深${simulation?.maxDepth || "?"}m，面积${simulation?.floodArea || "?"}km²。问题: ${question}`,
        },
      ];
      const text = await callDeepSeek(messages);
      return new Response(
        JSON.stringify({ answer: text, references: [] }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    return new Response(JSON.stringify({ error: `未知操作: ${action}` }), {
      status: 400,
      headers: corsHeaders,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "AI 服务错误" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
}
