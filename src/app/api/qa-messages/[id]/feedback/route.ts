import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { ensureLearningSchema, getQaMessage, addAiFeedback } from "@/lib/learning-db";

const VALID_REASONS = new Set(["内容错误", "解释不清", "答非所问", "信息不完整", "其他"]);

/** 学生对 AI 回答提交错误反馈（进入教师审核队列） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  const { id } = await params;
  try {
    const { reason, note } = await req.json().catch(() => ({}));
    if (!reason || !VALID_REASONS.has(String(reason))) {
      return NextResponse.json({ error: "请选择有效的反馈原因" }, { status: 400 });
    }
    await ensureLearningSchema();
    const message = await getQaMessage(Number(id));
    if (!message) return NextResponse.json({ error: "问答记录不存在" }, { status: 404 });
    if (message.user_email !== auth.email) return NextResponse.json({ error: "只能反馈自己的问答记录" }, { status: 403 });

    const fb = await addAiFeedback({
      messageId: Number(id),
      email: auth.email,
      reason: String(reason),
      note: String(note || "").slice(0, 1000),
    });
    return NextResponse.json({ ok: true, feedback: fb });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
