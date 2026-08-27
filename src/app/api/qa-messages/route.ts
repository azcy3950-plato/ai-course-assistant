import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { ensureLearningSchema, addQaMessage, listQaMessages } from "@/lib/learning-db";

/** 学生自己的 AI 问答存档（知识问答页每次回答后由前端写入一条） */
export async function GET(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    return NextResponse.json(await listQaMessages(auth.email));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    const { question, answer, references } = await req.json().catch(() => ({}));
    if (!question || !answer) return NextResponse.json({ error: "缺少问答内容" }, { status: 400 });
    await ensureLearningSchema();
    const msg = await addQaMessage({
      email: auth.email,
      question: String(question).slice(0, 2000),
      answer: String(answer).slice(0, 20000),
      references: Array.isArray(references) ? references : [],
    });
    return NextResponse.json({ ok: true, id: msg.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
