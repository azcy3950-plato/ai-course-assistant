import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  pool,
  ensureLearningSchema,
  getTask,
  getStudentTask,
  listTaskTargets,
  listTaskSubmissions,
  listStudentSubmissions,
  setStudentTaskStatus,
  addLearningEvent,
} from "@/lib/learning-db";

/** 对学生遮罩练习答案：选项保留，正确答案与解析隐藏 */
function maskQuestions(questions: any[]) {
  return questions.map((q) => {
    const { answer, explanation, ...rest } = q;
    return rest;
  });
}

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
      if (task.teacher_email !== auth.email) return NextResponse.json({ error: "无权查看该任务" }, { status: 403 });
      const [targets, submissions] = await Promise.all([listTaskTargets(taskId), listTaskSubmissions(taskId)]);
      return NextResponse.json({ task, targets, submissions });
    }

    const st = await getStudentTask(taskId, auth.email);
    if (!st) return NextResponse.json({ error: "你未被分配该任务" }, { status: 403 });
    const submissions = await listStudentSubmissions(taskId, auth.email);
    return NextResponse.json({
      task: { ...task, questions: maskQuestions(task.questions || []) },
      studentTask: st,
      submissions,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    await ensureLearningSchema();
    const taskId = Number(id);
    const task = await getTask(taskId);
    if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

    // 教师：编辑任务基本信息
    if (auth.role === "teacher") {
      if (task.teacher_email !== auth.email) return NextResponse.json({ error: "无权修改该任务" }, { status: 403 });
      let deadline = task.deadline;
      if ("deadline" in body) {
        deadline = body.deadline ? new Date(String(body.deadline)).toISOString() : null;
      }
      await pool.query(
        "UPDATE tasks SET title = $2, description = $3, deadline = $4 WHERE id = $1",
        [
          taskId,
          body.title != null ? String(body.title).trim() : task.title,
          body.description != null ? String(body.description) : task.description,
          deadline,
        ],
      );
      return NextResponse.json({ ok: true });
    }

    // 学生：开始 / 标记完成
    const st = await getStudentTask(taskId, auth.email);
    if (!st) return NextResponse.json({ error: "你未被分配该任务" }, { status: 403 });
    const action = String(body.action || "");
    if (action === "start") {
      if (st.status === "TODO") await setStudentTaskStatus(taskId, auth.email, "IN_PROGRESS");
      return NextResponse.json({ ok: true });
    }
    if (action === "complete") {
      if (st.status === "SUBMITTED" || st.status === "REVISION_REQUIRED") {
        return NextResponse.json({ error: "该任务需要提交并由教师批阅，不能直接标记完成" }, { status: 400 });
      }
      await setStudentTaskStatus(taskId, auth.email, "COMPLETED");
      const eventType =
        task.type === "GUIDED" ? "GUIDED_COMPLETED" : task.type === "KNOWLEDGE" ? "KNOWLEDGE_COMPLETED" : "TASK_COMPLETED";
      await addLearningEvent({
        userEmail: auth.email,
        type: eventType,
        title: `完成任务：${task.title}`,
        summary: task.title,
        refType: "task",
        refId: String(taskId),
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "无效操作" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
