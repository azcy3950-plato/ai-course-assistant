import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  ensureLearningSchema,
  getTask,
  getStudentTask,
  listTaskSubmissions,
  listStudentSubmissions,
  createSubmission,
  addLearningEvent,
  setStudentTaskStatus,
} from "@/lib/learning-db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  const { id } = await params;
  try {
    await ensureLearningSchema();
    const taskId = Number(id);
    const task = await getTask(taskId);
    if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    if (auth.role === "teacher") {
      if (task.teacher_email !== auth.email) return NextResponse.json({ error: "无权查看" }, { status: 403 });
      return NextResponse.json(await listTaskSubmissions(taskId));
    }
    const st = await getStudentTask(taskId, auth.email);
    if (!st) return NextResponse.json({ error: "你未被分配该任务" }, { status: 403 });
    return NextResponse.json(await listStudentSubmissions(taskId, auth.email));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    await ensureLearningSchema();
    const taskId = Number(id);
    const task = await getTask(taskId);
    if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

    if (auth.role === "teacher") return NextResponse.json({ error: "教师不能替学生提交" }, { status: 403 });
    const st = await getStudentTask(taskId, auth.email);
    if (!st) return NextResponse.json({ error: "你未被分配该任务" }, { status: 403 });

    // 练习任务：服务端判分（客户端提交选项，正确答案不暴露给学生）
    let answers: any[] = Array.isArray(body.answers) ? body.answers : [];
    const questions = (task.questions || []) as any[];
    if (task.type === "PRACTICE") {
      answers = body.answers.map((a: any, i: number) => {
        const q = questions[a.index ?? i];
        const correct = q ? String(a.studentAnswer).trim() === String(q.answer).trim() : false;
        return {
          index: a.index ?? i,
          question: q?.q || a.question || "",
          studentAnswer: a.studentAnswer ?? "",
          correctAnswer: q?.answer || "",
          isCorrect: correct,
        };
      });
    }

    const submission = await createSubmission(taskId, auth.email, {
      judgment: String(body.judgment || ""),
      explanation: String(body.explanation || ""),
      reflection: String(body.reflection || ""),
      answers,
    });

    // 练习任务全部答对 → 自动完成，无需教师批阅
    if (task.type === "PRACTICE" && answers.length > 0 && answers.every((a: any) => a.isCorrect)) {
      await setStudentTaskStatus(taskId, auth.email, "COMPLETED");
    }

    const eventType =
      task.type === "SIMULATION" ? "SIMULATION_SUBMITTED"
      : task.type === "PRACTICE" ? "PRACTICE_COMPLETED"
      : "TASK_SUBMITTED";
    await addLearningEvent({
      userEmail: auth.email,
      type: eventType,
      title: `提交任务：${task.title}`,
      summary: `第 ${submission.version} 次提交`,
      refType: "submission",
      refId: String(submission.id),
    });

    return NextResponse.json({ ok: true, submission });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
