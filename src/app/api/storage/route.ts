import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
  if (!req.headers.get("Authorization"))
    return NextResponse.json({ error: "未登录" }, { status: 401 });
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!req.headers.get("Authorization"))
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const { fileName, fileType } = await req.json();
    const safeName = fileName.replace(/[<>:"/\\|?*]/g, "_");
    const fileKey = "uploads/" + Date.now() + "_" + safeName;
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET, Key: fileKey, ContentType: fileType || "application/octet-stream" }),
      { expiresIn: 300 }
    );
    return NextResponse.json({ uploadUrl, fileKey, fileUrl: buildFileUrl(fileKey) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!req.headers.get("Authorization"))
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const { fileKey } = await req.json();
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fileKey }));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
