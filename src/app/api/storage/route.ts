import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { verify as jwtVerify } from "jsonwebtoken";

// 严格鉴权:解析 JWT 邮箱与角色,无效即 401;写操作仅限教师
function getUser(req: NextRequest): { email: string; role: string } | null {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const jwtSecret = process.env.JWT_SECRET;
  if (!token || !jwtSecret) return null;
  try {
    const payload = jwtVerify(token, jwtSecret) as { email?: string; role?: string };
    if (!payload.email) return null;
    return { email: payload.email, role: payload.role || "student" };
  } catch {
    return null;
  }
}

const s3 = new S3Client({
  region: "oss-cn-beijing",
  endpoint: process.env.OSS_ENDPOINT,
  credentials: {
    accessKeyId: process.env.OSS_ACCESS_KEY!,
    secretAccessKey: process.env.OSS_SECRET_KEY!,
  },
});

const BUCKET = process.env.OSS_BUCKET!;
const PUBLIC_URL = "https://" + BUCKET + "." + (process.env.OSS_ENDPOINT || "").replace("https://", "");

function buildFileUrl(fileKey: string): string {
  const parts = fileKey.split("/");
  const last = parts[parts.length - 1];
  const encoded = encodeURIComponent(last);
  return PUBLIC_URL + "/" + parts.slice(0, -1).join("/") + "/" + encoded;
}

export async function GET(req: NextRequest) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  // 文件列表仅教师可见(与学生 POST/DELETE 的 403 口径一致,防枚举)
  if (user.role !== "teacher") return NextResponse.json({ error: "仅教师可查看" }, { status: 403 });
  try {
    const { Contents } = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "uploads/" }));
    const files = (Contents || [])
      .filter((o) => o.Key && o.Key !== "uploads/")
      .map((o) => ({
        name: o.Key!.replace(/^uploads\/\d+_/, ""),
        key: o.Key!,
        size: o.Size || 0,
        url: buildFileUrl(o.Key!),
        lastModified: o.LastModified?.toISOString() || "",
      }))
      .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
    return NextResponse.json(files);
  } catch (err: any) {
    console.error('[storage] GET:', err?.message || err);
    return NextResponse.json({ error: "文件服务暂时不可用" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "teacher") return NextResponse.json({ error: "仅教师可上传" }, { status: 403 });
  try {
    const { fileName, fileType } = await req.json();
    if (!fileName || typeof fileName !== "string") return NextResponse.json({ error: "参数缺失" }, { status: 400 });
    const safeName = fileName.replace(/[<>:"/\\|?*]/g, "_");
    // ContentType 白名单:仅允许常见文档/图片类型,防上传 HTML 到公开桶(存储型 XSS 载体)
    const allowedTypes = ["application/pdf", "text/plain", "text/markdown", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/png", "image/jpeg", "image/gif", "application/octet-stream"];
    const ct = allowedTypes.includes(fileType) ? fileType : "application/octet-stream";
    const fileKey = "uploads/" + Date.now() + "_" + safeName;
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET, Key: fileKey, ContentType: ct }),
      { expiresIn: 300 }
    );
    return NextResponse.json({ uploadUrl, fileKey, fileUrl: buildFileUrl(fileKey), contentType: ct });
  } catch (err: any) {
    console.error('[storage] POST:', err?.message || err);
    return NextResponse.json({ error: "上传服务暂时不可用" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "teacher") return NextResponse.json({ error: "仅教师可删除" }, { status: 403 });
  try {
    const { fileKey } = await req.json();
    // 强制 uploads/ 前缀,防删除桶内任意对象
    if (typeof fileKey !== "string" || !fileKey.startsWith("uploads/") || fileKey === "uploads/") {
      return NextResponse.json({ error: "无权访问该文件" }, { status: 403 });
    }
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fileKey }));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[storage] DELETE:', err?.message || err);
    return NextResponse.json({ error: "删除服务暂时不可用" }, { status: 500 });
  }
}
