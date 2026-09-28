import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { verify as jwtVerify } from "jsonwebtoken";

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY;
const OSS_BUCKET = process.env.OSS_BUCKET || "ai-course-assistant";
// 模块级连接池：此前每请求新建 Pool 且循环内异常路径不释放（连接泄漏）
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
    // 非标/损坏 docx 缺 document.xml：null 检查返回空，避免 TypeError → 500
    const docEntry = zip.file("word/document.xml");
    if (!docEntry) return "";
    const docXml = await docEntry.async("string");
    return docXml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

const pdfParsePromise = import("pdf-parse/lib/pdf-parse.js").then((m) => m.default);

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const jwtSecret = process.env.JWT_SECRET;
  const user = token && jwtSecret ? (() => { try { return jwtVerify(token, jwtSecret) as { email?: string; role?: string }; } catch { return null; } })() : null;
  if (!user?.email) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  // 消耗向量化成本,仅教师可调用
  if ((user.role || "student") !== "teacher") {
    return NextResponse.json({ error: "仅教师可处理文件" }, { status: 403 });
  }

  try {
    const { fileName, fileUrl: requestedFileUrl, fileKey: requestedFileKey } = await req.json();
    if (!fileName || (!requestedFileUrl && !requestedFileKey)) {
      return NextResponse.json({ error: "参数缺失" }, { status: 400 });
    }

    // Download via S3 client (bucket is private)
    let key = typeof requestedFileKey === "string" ? requestedFileKey : "";
    if (!key && requestedFileUrl) {
      try {
        const urlObj = new URL(requestedFileUrl);
        key = decodeURIComponent(urlObj.pathname.substring(1));
      } catch {
        return NextResponse.json({ error: "无效的文件地址" }, { status: 400 });
      }
    }
    // 归属校验:只允许读取 uploads/ 前缀的教师上传对象,防越权读取其他存储
    if (!key.startsWith("uploads/")) {
      return NextResponse.json({ error: "无权访问该文件" }, { status: 403 });
    }
    // 入库链接由服务端按自家 OSS 域名重建（防教师传入外部域名的伪造链接，后续被渲染给学生）
    const endpointHost = (process.env.OSS_ENDPOINT || "oss-cn-beijing.aliyuncs.com").replace("https://", "").replace("http://", "");
    const fileUrlSafe = `https://${OSS_BUCKET}.${endpointHost}/${key}`;
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
    let stored = 0;
    for (const chunk of chunks) {
      try {
        const emb = await getEmbedding(chunk);
        if (emb) {
          await pool.query(
            "INSERT INTO document_chunks (doc_name, content, embedding, file_url) VALUES ($1, $2, $3, $4)",
            [fileName, chunk, JSON.stringify(emb), fileUrlSafe]
          );
          stored++;
        }
      } catch (e) { console.error(e); }
    }

    return NextResponse.json({
      ok: true,
      chunks: stored,
      totalChunks: chunks.length,
      message: "提取 " + (text.length / 1000).toFixed(0) + "k 字，向量化 " + stored + "/" + chunks.length + " 片段",
    });
  } catch (err: any) {
    console.error('[process-file]:', err?.message || err);
    return NextResponse.json({ error: "文件处理服务暂时不可用" }, { status: 500 });
  }
}
