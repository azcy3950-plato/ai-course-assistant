import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { maskQuestions } from "@/lib/task-ui";
import {
  pool,
  ensureLearningSchema,
  listTaskAttachments,
  getTask,
  getStudentTask,
  listTaskTargets,
  listTaskSubmissions,
  listStudentSubmissions,
  setStudentTaskStatus,
  addLearningEvent,
} from "@/lib/learning-db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, resp } = await requireUser(req);
  if (resp) return resp;
  const { id } = await params;
  try {
    await ensureLearningSchema();
    const taskId = Number(id);
    if (!Number.isFinite(taskId)) return NextResponse.json({ error: "任务不存在" }, { status: 400 });
    const task = await getTask(taskId);
    if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

    if (auth.role === "teacher" || auth.role === "admin") {
      if (auth.role !== "admin" && task.teacher_email !== auth.email) return NextResponse.json({ error: "无权查看该任务" }, { status: 403 });
      const [targets, submissions, attachments] = await Promise.all([
        listTaskTargets(taskId), listTaskSubmissions(taskId), listTaskAttachments(taskId),
      ]);
      return NextResponse.json({ task, targets, submissions, attachments });
    }

    const st = await getStudentTask(taskId, auth.email);
    if (!st) return NextResponse.json({ error: "你未被分配该任务" }, { status: 403 });
    const [submissions, attachments] = await Promise.all([
      listStudentSubmissions(taskId, auth.email),
      listTaskAttachments(taskId),
    ]);
    return NextResponse.json({
      task: { ...task, questions: maskQuestions(task.questions || []) },
      studentTask: st,
      submissions,
      attachments,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, resp } = await requireUser(req);
  if (resp) return resp;
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    await ensureLearningSchema();
    const taskId = Number(id);
    if (!Number.isFinite(taskId)) return NextResponse.json({ error: "任务不存在" }, { status: 400 });
    const task = await getTask(taskId);
    if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

    // 教师：编辑任务基本信息
    if (auth.role === "teacher" || auth.role === "admin") {
      if (auth.role !== "admin" && task.teacher_email !== auth.email) return NextResponse.json({ error: "无权修改该任务" }, { status: 403 });
      let deadline = task.deadline;
      if ("deadline" in body) {
        if (!body.deadline) {
          deadline = null;
        } else {
          const d = new Date(String(body.deadline));
          if (isNaN(d.getTime())) return NextResponse.json({ error: "截止时间格式无效" }, { status: 400 });
          deadline = d.toISOString();
        }
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
      // 类型限定：练习/仿真必须在线完成并提交（服务端判分/教师批阅），不可自评完成
      if (!["KNOWLEDGE", "GUIDED", "REMEDIAL"].includes(task.type)) {
        return NextResponse.json({ error: "该任务需在线完成并提交，不能直接标记完成" }, { status: 400 });
      }
      // 截止校验：超期不可完成
      if (task.deadline && new Date(task.deadline).getTime() < Date.now()) {
        return NextResponse.json({ error: "已超过截止时间，无法完成" }, { status: 400 });
      }
      // 标记完成必须附一句"我的收获"（教师可见），避免零证据完成
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (!note || note.length > 500) {
        return NextResponse.json({ error: "请填写一句本次学习的收获（1-500 字）" }, { status: 400 });
      }
      await setStudentTaskStatus(taskId, auth.email, "COMPLETED", note);
      const eventType =
        task.type === "GUIDED" ? "GUIDED_COMPLETED" : task.type === "KNOWLEDGE" ? "KNOWLEDGE_COMPLETED" : "TASK_COMPLETED";
      await addLearningEvent({
        userEmail: auth.email,
        type: eventType,
        title: `完成任务：${task.title}`,
        summary: note,
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
