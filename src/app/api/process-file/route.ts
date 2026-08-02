import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY;
const OSS_BUCKET = process.env.OSS_BUCKET || "ai-course-assistant";

const s3 = new S3Client({
  region: "oss-cn-beijing",
  endpoint: process.env.OSS_ENDPOINT || "https://oss-cn-beijing.aliyuncs.com",
  credentials: {
    accessKeyId: process.env.OSS_ACCESS_KEY || "",
    secretAccessKey: process.env.OSS_SECRET_KEY || "",
  },
});

async function getEmbedding(text: string) {
  const res = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + DASHSCOPE_KEY,
      },
      body: JSON.stringify({ model: "text-embedding-v2", input: text }),
    }
  );
  const data = await res.json();
  return data.data?.[0]?.embedding;
}

function chunkText(text: string, maxLen = 500): string[] {
  const sentences = text.split(/(?<=[。！？.!?])\s*/);
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > maxLen && current.length > 100) {
      chunks.push(current.trim()); current = s;
    } else { current += s; }
  }
  if (current.trim().length > 20) chunks.push(current.trim());
  return chunks;
}

async function extractOfficeText(buffer: Buffer, ext: string): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  if (ext === "pptx") {
    const slideFiles = Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml/.test(f));
    slideFiles.sort();
    let text = "";
    for (const f of slideFiles) {
      const xml = await zip.file(f)!.async("string");
      text += xml.replace(/<[^>]+>/g, " ") + "\n";
    }
    return text.replace(/\s+/g, " ").trim();
  }
  if (ext === "docx") {
    const docXml = await zip.file("word/document.xml")!.async("string");
    return docXml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

const pdfParsePromise = import("pdf-parse/lib/pdf-parse.js").then((m) => m.default);

export async function POST(req: NextRequest) {
  if (!req.headers.get("Authorization")) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const { fileName, fileUrl } = await req.json();
    if (!fileName || !fileUrl) {
      return NextResponse.json({ error: "参数缺失" }, { status: 400 });
    }

    // Download via S3 client (bucket is private)
    const urlObj = new URL(fileUrl);
    const key = decodeURIComponent(urlObj.pathname.substring(1));
    const s3Res = await s3.send(new GetObjectCommand({ Bucket: OSS_BUCKET, Key: key }));
    const bufChunks: Buffer[] = [];
    if (s3Res.Body) {
      for await (const c of s3Res.Body as any) { bufChunks.push(Buffer.from(c)); }
    }
    const buffer = Buffer.concat(bufChunks);

    // Extract text
    let text = "";
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (ext === "pdf") {
      const pdfParse = await pdfParsePromise;
      const data = await pdfParse(buffer);
      text = data.text || "";
    } else if (ext === "pptx" || ext === "docx") {
      text = await extractOfficeText(buffer, ext);
    } else if (ext === "txt" || ext === "md") {
      text = buffer.toString("utf-8");
    } else {
      return NextResponse.json({ ok: true, chunks: 0, message: ext + " 格式暂不支持" });
    }

    if (!text || text.trim().length < 20) {
      return NextResponse.json({ ok: true, chunks: 0, message: "未检测到文字" });
    }

    // Chunk
    const chunks = chunkText(text);
    if (!chunks.length) return NextResponse.json({ ok: true, chunks: 0 });

    // Embed & store
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    let stored = 0;
    for (const chunk of chunks) {
      try {
        const emb = await getEmbedding(chunk);
        if (emb) {
          await pool.query(
            "INSERT INTO document_chunks (doc_name, content, embedding, file_url) VALUES ($1, $2, $3, $4)",
            [fileName, chunk, JSON.stringify(emb), fileUrl]
          );
          stored++;
        }
      } catch (e) { console.error(e); }
    }
    await pool.end();

    return NextResponse.json({
      ok: true,
      chunks: stored,
      totalChunks: chunks.length,
      message: "提取 " + (text.length / 1000).toFixed(0) + "k 字，向量化 " + stored + "/" + chunks.length + " 片段",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
