import { NextRequest, NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth-server";
import { pool, ensureLearningSchema, listDocumentStatus, upsertDocumentStatus } from "@/lib/learning-db";
import { logAudit } from "@/lib/audit";

/** 知识库文档解析状态（教师）：列表 / 更新 / 删除 */
export async function GET(req: NextRequest) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    const items = await listDocumentStatus();
    return NextResponse.json({ items });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  try {
    const body = await req.json().catch(() => ({}));
    const fileKey = String(body.fileKey || "");
    const fileName = String(body.fileName || fileKey);
    const status = String(body.status || "UPLOADING");
    if (!fileKey || !["UPLOADING", "PARSING", "INDEXING", "READY", "FAILED"].includes(status)) {
      return NextResponse.json({ error: "参数无效" }, { status: 400 });
    }
    await ensureLearningSchema();
    const row = await upsertDocumentStatus({
      fileKey, fileName, status,
      chunkCount: Number(body.chunkCount || 0),
      error: String(body.error || ""),
      uploadedBy: String(body.uploadedBy || auth.email),
    });
    if (status === "READY") {
      await logAudit({ operatorEmail: auth.email, action: "KB_INDEXED", targetType: "document", targetId: fileKey, detail: fileName });
    }
    return NextResponse.json({ ok: true, item: row });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  try {
    const { fileKey } = await req.json().catch(() => ({}));
    if (!fileKey) return NextResponse.json({ error: "缺少 fileKey" }, { status: 400 });
    await ensureLearningSchema();
    await pool.query("DELETE FROM document_status WHERE file_key = $1", [fileKey]);
    await logAudit({ operatorEmail: auth.email, action: "KB_DELETE", targetType: "document", targetId: fileKey });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
