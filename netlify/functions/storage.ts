import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const OSS_ACCESS_KEY = process.env.OSS_ACCESS_KEY!;
const OSS_SECRET_KEY = process.env.OSS_SECRET_KEY!;
const OSS_ENDPOINT = process.env.OSS_ENDPOINT!;
const OSS_BUCKET = process.env.OSS_BUCKET!;

const s3 = new S3Client({
  region: "oss-cn-beijing",
  endpoint: OSS_ENDPOINT,
  credentials: {
    accessKeyId: OSS_ACCESS_KEY,
    secretAccessKey: OSS_SECRET_KEY,
  },
  forcePathStyle: false,
});

const PUBLIC_URL = `https://${OSS_BUCKET}.${OSS_ENDPOINT.replace("https://", "")}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check
  if (!req.headers.get("Authorization")) {
    return new Response(JSON.stringify({ error: "未登录" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    // ══════════════ GET — list files ══════════════
    if (req.method === "GET") {
      const { Contents } = await s3.send(
        new ListObjectsV2Command({ Bucket: OSS_BUCKET, Prefix: "uploads/" })
      );

      const files = (Contents || [])
        .filter((o) => o.Key && o.Key !== "uploads/")
        .map((o) => ({
          name: o.Key!.split("/").pop() || o.Key!,
          key: o.Key!,
          size: o.Size || 0,
          url: `${PUBLIC_URL}/${o.Key}`,
          lastModified: o.LastModified?.toISOString() || "",
        }))
        .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

      return new Response(JSON.stringify(files), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // ══════════════ POST — get upload URL ══════════════
    if (req.method === "POST") {
      const { fileName, fileType } = await req.json();
      if (!fileName) {
        return new Response(JSON.stringify({ error: "缺少文件名" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const ext = fileName.split(".").pop() || "";
      const fileKey = `uploads/${randomUUID()}.${ext}`;

      const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: OSS_BUCKET,
          Key: fileKey,
          ContentType: fileType || "application/octet-stream",
        }),
        { expiresIn: 300 }
      );

      return new Response(
        JSON.stringify({
          uploadUrl,
          fileKey,
          fileUrl: `${PUBLIC_URL}/${fileKey}`,
        }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ══════════════ DELETE ══════════════
    if (req.method === "DELETE") {
      const { fileKey } = await req.json();
      await s3.send(new DeleteObjectCommand({ Bucket: OSS_BUCKET, Key: fileKey }));

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({ error: "方法不允许" }), {
      status: 405, headers: corsHeaders,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "服务器错误" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
}
