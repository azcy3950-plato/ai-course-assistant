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
  const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + DASHSCOPE_KEY },
    body: JSON.stringify({ model: "text-embedding-v2", input: text }),
  });
  const data = await res.json();
  return data.data?.[0]?.embedding;
}

function chunkText(text: string, maxLen = 500): string[] {
  const sentences = text.split(/(?<=[。！？.!?])\s*/);
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > maxLen && current.length > 100) { chunks.push(current.trim()); current = s; }
    else { current += s; }
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
    for (const f of slideFiles) { const xml = await zip.file(f)!.async("string"); text += xml.replace(/<[^>]+>/g, " ") + "\n"; }
    return text.replace(/\s+/g, " ").trim();
  }
  if (ext === "docx") {
    const docXml = await zip.file("word/document.xml")!.async("string");
    return docXml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

export async function POST(req: NextRequest) {
  if (!req.headers.get("Authorization")) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const { fileName, fileUrl } = await req.json();
    if (!fileName || !fileUrl) return NextResponse.json({ error: "参数缺失" }, { status: 400 });

    // Download via S3 client
    const urlObj = new URL(fileUrl);
    const key = decodeURIComponent(urlObj.pathname.substring(1));
    const s3Res = await s3.send(new GetObjectCommand({ Bucket: OSS_BUCKET, Key: key }));

    // Convert stream to buffer - AWS SDK v3 compatible approach
    const body = s3Res.Body as any;
    let buffer: Buffer;
    if (body?.transformToByteArray) {
      buffer = Buffer.from(await body.transformToByteArray());
    } else {
      // Fallback: collect manually
      const chunks: Buffer[] = [];
      for await (const chunk of body) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); }
      buffer = Buffer.concat(chunks);
    }

    // Extract text
    let text = "";
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (ext === "pdf") {
      const PDFParser = (await import("pdf2json")).default;
      text = await new Promise((resolve) => {
        const parser = new PDFParser();
        let result = "";
        parser.on("pdfParser_dataReady", (data: any) => {
          try {
            data.Pages?.forEach((p: any) => p.Texts?.forEach((t: any) => {
              result += decodeURIComponent(t.R?.[0]?.T || "") + " ";
            }));
          } catch(e) {}
          resolve(result);
        });
        parser.on("pdfParser_dataError", () => resolve(""));
        parser.parseBuffer(buffer);
        setTimeout(() => resolve(result), 15000);
      });
      // OCR fallback for image-based/corrupted PDFs
      if (!text || text.trim().length < 20) {
        try {
          const { execSync } = await import("child_process");
          const { default: fs } = await import("fs");
          const tmpDir = "/tmp/ocr-" + Date.now();
          fs.mkdirSync(tmpDir);
          fs.writeFileSync(tmpDir + "/input.pdf", buffer);
          execSync("pdftoppm -png -r 200 -f 1 -l 3 " + tmpDir + "/input.pdf " + tmpDir + "/page", { timeout: 60000 });
          const pageFiles = fs.readdirSync(tmpDir).filter((f: string) => f.endsWith(".png")).sort();
          const ocrTexts: string[] = [];
          for (const pf of pageFiles.slice(0, 3)) {
            try {
              const outFile = tmpDir + "/ocrout";
              execSync("tesseract " + tmpDir + "/" + pf + " " + outFile + " -l chi_sim+eng 2>/dev/null", { timeout: 30000 });
              if (fs.existsSync(outFile + ".txt")) ocrTexts.push(fs.readFileSync(outFile + ".txt", "utf-8"));
            } catch(e) {}
          }
          // Clean OCR artifacts: remove spaces between Chinese chars
          text = ocrTexts.join(" ").replace(/([一-鿿]) (?=[一-鿿])/g, "$1").replace(/\s+/g, " ").trim();
          try { execSync("rm -rf " + tmpDir); } catch(e) {}
        } catch(e) { console.error("OCR fallback error:", e); }
      }
    } else if (ext === "pptx" || ext === "docx") {
      text = await extractOfficeText(buffer, ext);
    } else if (ext === "txt" || ext === "md") {
      text = buffer.toString("utf-8");
    } else {
      return NextResponse.json({ ok: true, chunks: 0, message: ext + " 格式暂不支持" });
    }

    if (!text || text.trim().length < 20) return NextResponse.json({ ok: true, chunks: 0, message: "未检测到文字" });

    const chunks = chunkText(text);
    if (!chunks.length) return NextResponse.json({ ok: true, chunks: 0, message: "文本太短" });

    // Embed & store
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const fileUrlEncoded = fileUrl.split("/").map((p: string, i: number) => i === fileUrl.split("/").length - 1 ? encodeURIComponent(p) : p).join("/");
    let stored = 0;
    for (const chunk of chunks) {
      try {
        const emb = await getEmbedding(chunk);
        if (emb) {
          await pool.query("INSERT INTO document_chunks (doc_name, content, embedding, file_url) VALUES ($1,$2,$3,$4)", [fileName, chunk, JSON.stringify(emb), fileUrlEncoded]);
          stored++;
        }
      } catch (e) { console.error("chunk error:", e); }
    }
    await pool.end();

    return NextResponse.json({ ok: true, chunks: stored, totalChunks: chunks.length, message: "提取 " + (text.length / 1000).toFixed(0) + "k 字，向量化 " + stored + "/" + chunks.length + " 片段" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
