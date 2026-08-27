import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { ensureLearningSchema, listCorrectedQuizIds } from "@/lib/learning-db";

/** 学生已订正的错题 ID 集合（订正动作经由 POST /api/learning-events 完成） */
export async function GET(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    const ids = await listCorrectedQuizIds(auth.email);
    return NextResponse.json({ ids: [...ids] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
