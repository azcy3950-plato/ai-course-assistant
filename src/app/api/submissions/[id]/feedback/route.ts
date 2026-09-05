import { NextRequest, NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth-server";
import { ensureLearningSchema, addTeacherFeedback, addLearningEvent, addNotification, getTask } from "@/lib/learning-db";
import { logAudit } from "@/lib/audit";

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

    // 通知学生
    const taskInfo = await getTask(result.submission.task_id).catch(() => null);
    const taskTitle = taskInfo?.title || "任务";
    const notifType = status === "passed" ? "TEACHER_FEEDBACK" : "REVISION_REQUIRED";
    addNotification({
      userEmail: result.submission.user_email,
      type: notifType,
      title: status === "passed" ? `教师已批阅：${taskTitle}` : `任务需要修改：${taskTitle}`,
      body: String(content).slice(0, 120),
      link: `/tasks/${result.submission.task_id}`,
    }).catch(() => {});
    await logAudit({ operatorEmail: auth.email, action: "FEEDBACK_SUBMIT", targetType: "submission", targetId: String(result.submission.id), detail: status });
    return NextResponse.json({ ok: true, feedback: result.feedback });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
