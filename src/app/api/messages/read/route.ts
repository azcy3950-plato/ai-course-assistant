import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { ensureLearningSchema, markDirectMessagesRead } from "@/lib/learning-db";
import { authorizeDmPair } from "@/lib/dm-auth";

/** 打开会话时标记"对端发给我的"消息为已读 */
export async function PUT(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    const body = await req.json().catch(() => ({}));
    await ensureLearningSchema();
    const { resp: authResp, pair } = await authorizeDmPair(req, String(body.with || ""));
    if (authResp || !pair) return authResp;
    const marked = await markDirectMessagesRead(pair.studentEmail, pair.teacherEmail, auth.email);
    return NextResponse.json({ ok: true, marked });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
