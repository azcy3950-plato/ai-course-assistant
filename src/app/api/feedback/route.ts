import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { ensureLearningSchema, listFeedbackForStudent } from "@/lib/learning-db";

/** 学生统一查看收到的全部教师反馈 */
export async function GET(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    return NextResponse.json(await listFeedbackForStudent(auth.email));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
