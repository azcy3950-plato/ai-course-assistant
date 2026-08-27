import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { pool, ensureLearningSchema, getQaMessage, listAiVersions } from "@/lib/learning-db";

/** 单条问答详情：原回答 + 版本历史 + 反馈状态（仅本人） */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  const { id } = await params;
  try {
    await ensureLearningSchema();
    const message = await getQaMessage(Number(id));
    if (!message) return NextResponse.json({ error: "问答记录不存在" }, { status: 404 });
    if (message.user_email !== auth.email) return NextResponse.json({ error: "只能查看自己的问答记录" }, { status: 403 });
    const [versions, feedback] = await Promise.all([
      listAiVersions(Number(id)),
      pool.query("SELECT * FROM ai_content_feedback WHERE message_id = $1 ORDER BY created_at DESC", [Number(id)]),
    ]);
    return NextResponse.json({ message, versions, feedback: feedback.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
