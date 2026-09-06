import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { getObjectSize, deleteObject } from "@/lib/oss";
import {
  addNotification,
  addTaskAttachment,
  ensureLearningSchema,
  getTask,
  getStudentTask,
  listTaskSubmissions,
  listTaskAttachments,
  listStudentSubmissions,
  createSubmission,
  addLearningEvent,
  setStudentTaskStatus,
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
    if (auth.role === "teacher") {
      if (task.teacher_email !== auth.email) return NextResponse.json({ error: "无权查看" }, { status: 403 });
      const [subs, atts] = await Promise.all([listTaskSubmissions(taskId), listTaskAttachments(taskId)]);
      return NextResponse.json({ submissions: subs, attachments: atts });
    }
    const st = await getStudentTask(taskId, auth.email);
    if (!st) return NextResponse.json({ error: "你未被分配该任务" }, { status: 403 });
    // 防双击：已提交且未被要求修改时拒绝再次提交（练习任务除外——允许重新作答）
    if (st.status === "SUBMITTED" && task.type !== "PRACTICE") {
      return NextResponse.json({ error: "已提交，等待教师批阅" }, { status: 400 });
    }
    return NextResponse.json(await listStudentSubmissions(taskId, auth.email));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    if (auth.role === "teacher") return NextResponse.json({ error: "教师不能替学生提交" }, { status: 403 });
    const st = await getStudentTask(taskId, auth.email);
    if (!st) return NextResponse.json({ error: "你未被分配该任务" }, { status: 403 });

    // 防双击：已提交且未被要求修改时拒绝再次提交（练习任务除外——允许重新作答）
    if (st.status === "SUBMITTED" && task.type !== "PRACTICE") {
      return NextResponse.json({ error: "已提交，等待教师批阅" }, { status: 400 });
    }
    // 截止校验：超期不可提交（OVERDUE 仅作展示，行为上强制）
    if (task.deadline && new Date(task.deadline).getTime() < Date.now()) {
      return NextResponse.json({ error: "已超过截止时间，无法提交" }, { status: 400 });
    }

    // 练习任务：服务端判分（客户端提交选项，正确答案不暴露给学生）
    let answers: any[] = Array.isArray(body.answers) ? body.answers : [];
    const questions = (task.questions || []) as any[];
    if (task.type === "PRACTICE") {
      // 用已 sanitize 的 answers 判分（此前读 body.answers，缺参时 undefined.map 抛 500）
      answers = answers.map((a: any, i: number) => {
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

    // 附件：预签名上传后客户端提交元数据，服务端登记（≤5 个/提交，单文件 ≤10MB）
    // 大小以 OSS HeadObject 回读为准（客户端声明值可伪造），超限删除对象并跳过登记
    if (Array.isArray(body.attachments)) {
      for (const att of body.attachments.slice(0, 5)) {
        const key = String(att?.fileKey || "");
        if (!key.startsWith("task-attachments/")) continue;
        const realSize = await getObjectSize(key).catch(() => null);
        if (realSize === null) continue; // 对象不存在（上传未完成）→ 不登记
        if (realSize > 10 * 1024 * 1024) {
          await deleteObject(key);
          continue;
        }
        await addTaskAttachment({
          submissionId: submission.id,
          fileKey: key,
          fileName: String(att.fileName || key).slice(0, 255),
          fileSize: realSize,
          mime: String(att.mime || "").slice(0, 100),
          uploadedBy: auth.email,
        }).catch(() => {});
      }
    }

    // 通知教师（重交区分类型）
    addNotification({
      userEmail: task.teacher_email,
      type: submission.version > 1 ? "RESUBMISSION_RECEIVED" : "SUBMISSION_RECEIVED",
      dedupeKey: `SUBMISSION:${submission.id}:${submission.version}`,
      title: submission.version > 1 ? `学生重新提交：${task.title}` : `学生提交：${task.title}`,
      body: `${auth.email} 第 ${submission.version} 版提交`,
      link: `/teacher/tasks/${taskId}`,
    }).catch(() => {});
    return NextResponse.json({ ok: true, submission });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
