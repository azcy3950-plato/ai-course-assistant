import { S3Client, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

/** OSS（阿里云 S3 兼容）共享客户端；附件上传/下载与大小校验共用 */
export const s3 = new S3Client({
  region: "oss-cn-beijing",
  endpoint: process.env.OSS_ENDPOINT,
  credentials: {
    accessKeyId: process.env.OSS_ACCESS_KEY!,
    secretAccessKey: process.env.OSS_SECRET_KEY!,
  },
});

export const BUCKET = process.env.OSS_BUCKET!;

/** 回读对象真实大小（字节）；对象不存在返回 null */
export async function getObjectSize(key: string): Promise<number | null> {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return r.ContentLength ?? null;
  } catch {
    return null;
  }
}

/** 删除对象（静默失败） */
export async function deleteObject(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch { /* 忽略 */ }
}
