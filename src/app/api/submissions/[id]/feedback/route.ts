import { NextRequest, NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth-server";
import { ensureLearningSchema, addTeacherFeedback, addLearningEvent } from "@/lib/learning-db";

/** 教师批阅提交：写评语 + 通过 / 要求修改 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  const { id } = await params;
  try {
    const { content, status } = await req.json().catch(() => ({}));
    if (!content || !String(content).trim()) return NextResponse.json({ error: "评语不能为空" }, { status: 400 });
    if (status !== "passed" && status !== "revision_required") {
      return NextResponse.json({ error: "无效的批阅状态" }, { status: 400 });
    }
    await ensureLearningSchema();
    const result: any = await addTeacherFeedback(Number(id), auth.email, String(content).trim(), status);
    if (!result) return NextResponse.json({ error: "提交不存在" }, { status: 404 });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 403 });

    await addLearningEvent({
      userEmail: result.submission.user_email,
      type: "TEACHER_FEEDBACK_RECEIVED",
      title: status === "passed" ? "任务通过：教师已批阅" : "教师反馈：需要修改",
      summary: String(content).slice(0, 100),
      refType: "submission",
      refId: String(result.submission.id),
    });

    return NextResponse.json({ ok: true, feedback: result.feedback });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
