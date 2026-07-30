const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ── DashScope embedding ──
async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify({ model: "text-embedding-v2", input: text }),
    }
  );
  const data = await res.json();
  return data.data?.[0]?.embedding;
}

// ── Store chunk in Supabase ──
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
    body: JSON.stringify({ doc_name: docName, chapter, content, embedding }),
  });
}

// ── Simple text chunker ──
function chunkText(text: string, maxLen = 500): string[] {
  const sentences = text.split(/(?<=[。！？.!?])\s*/);
  const chunks: string[] = [];
  let current = "";

  for (const s of sentences) {
    if (current.length + s.length > maxLen && current.length > 100) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim().length > 20) chunks.push(current.trim());
  return chunks;
}

// ── Extract text from PDF buffer ──
async function extractPdfText(fileBuffer: ArrayBuffer): Promise<string> {
  // pdf-parse is CommonJS; dynamic import
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(Buffer.from(fileBuffer));
  return data.text || "";
}

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: corsHeaders,
    });
  }

  if (!req.headers.get("Authorization")) {
    return new Response(JSON.stringify({ error: "未登录" }), {
      status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const { fileName, fileUrl } = await req.json();
    if (!fileName || !fileUrl) {
      return new Response(JSON.stringify({ error: "缺少参数" }), {
        status: 400, headers: corsHeaders,
      });
    }

    // 1) Download file from OSS
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error("下载文件失败");
    const fileBuffer = await fileRes.arrayBuffer();

    // 2) Extract text
    let text = "";
    const ext = fileName.split(".").pop()?.toLowerCase() || "";

    if (ext === "pdf") {
      text = await extractPdfText(fileBuffer);
    } else if (ext === "txt" || ext === "md") {
      text = new TextDecoder().decode(fileBuffer);
    } else {
      return new Response(
        JSON.stringify({ ok: true, chunks: 0, message: `${ext} 格式暂不支持自动提取，请上传 PDF 或 TXT` }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!text || text.trim().length < 20) {
      return new Response(
        JSON.stringify({ ok: true, chunks: 0, message: "文件中未检测到可提取的文字" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // 3) Chunk
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, chunks: 0, message: "文本太短，无法分段" }),
        { headers: corsHeaders }
      );
    }

    // 4) Embed & store
    let stored = 0;
    for (const chunk of chunks) {
      try {
        const embedding = await getEmbedding(chunk);
        if (embedding) {
          await storeChunk(fileName, "", chunk, embedding);
          stored++;
        }
      } catch (e) {
        console.error("Embed chunk failed:", e);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        chunks: stored,
        totalChunks: chunks.length,
        message: `成功提取 ${(text.length / 1000).toFixed(0)}k 字，向量化 ${stored}/${chunks.length} 个片段`,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "处理失败" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}
