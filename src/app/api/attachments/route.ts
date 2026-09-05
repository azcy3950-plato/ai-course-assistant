import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireUser } from "@/lib/auth-server";
import crypto from "crypto";

/**
 * 任务提交附件（学生上传 / 教师与学生下载）。
 * 仅允许 task-attachments/ 前缀，单文件 ≤10MB（服务端提示，前端同样限制）。
 */
const s3 = new S3Client({
  region: "oss-cn-beijing",
  endpoint: process.env.OSS_ENDPOINT,
  credentials: {
    accessKeyId: process.env.OSS_ACCESS_KEY!,
    secretAccessKey: process.env.OSS_SECRET_KEY!,
  },
});
const BUCKET = process.env.OSS_BUCKET!;

const ALLOWED_TYPES = ["application/pdf", "text/plain", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/png", "image/jpeg", "image/gif", "image/webp"];

export async function POST(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    const { fileName, fileType, fileSize } = await req.json().catch(() => ({}));
    if (!fileName || typeof fileName !== "string") return NextResponse.json({ error: "参数缺失" }, { status: 400 });
    if (Number(fileSize) > 10 * 1024 * 1024) return NextResponse.json({ error: "附件不能超过 10MB" }, { status: 400 });
    const safeName = fileName.replace(/[<>:"/\\|?*]/g, "_");
    const ct = ALLOWED_TYPES.includes(fileType) ? fileType : "application/octet-stream";
    const fileKey = `task-attachments/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}`;
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET, Key: fileKey, ContentType: ct }),
      { expiresIn: 300 },
    );
    return NextResponse.json({ uploadUrl, fileKey, contentType: ct });
  } catch (err: any) {
    console.error('[attachments] POST:', err?.message || err);
    return NextResponse.json({ error: "上传服务暂时不可用" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  const key = req.nextUrl.searchParams.get("key") || "";
  if (!key.startsWith("task-attachments/")) {
    return NextResponse.json({ error: "无效的附件路径" }, { status: 400 });
  }
  try {
    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 600 },
    );
    return NextResponse.json({ url: downloadUrl });
  } catch (err: any) {
    console.error('[attachments] GET:', err?.message || err);
    return NextResponse.json({ error: "下载服务暂时不可用" }, { status: 500 });
  }
}
