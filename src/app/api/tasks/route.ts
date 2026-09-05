import { NextRequest, NextResponse } from "next/server";
import { requireUser, requireTeacher } from "@/lib/auth-server";
import { addNotification } from "@/lib/learning-db";
import { logAudit } from "@/lib/audit";
import {
  ensureLearningSchema,
  listTeacherTasks,
  listStudentTasks,
  createTask,
  getClass,
  listClassStudents,
  listTeacherStudentEmails,
  type TaskType,
  type TaskInput,
} from "@/lib/learning-db";

const VALID_TYPES: TaskType[] = ["KNOWLEDGE", "PRACTICE", "GUIDED", "SIMULATION", "REMEDIAL"];

export async function GET(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    const rows = auth.role === "teacher" ? await listTeacherTasks(auth.email) : await listStudentTasks(auth.email);
    return NextResponse.json(rows);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  try {
    const body = await req.json().catch(() => ({}));
    const title = String(body.title || "").trim();
    const type = String(body.type || "") as TaskType;
    if (!title) return NextResponse.json({ error: "任务标题不能为空" }, { status: 400 });
    if (!VALID_TYPES.includes(type)) return NextResponse.json({ error: "无效的任务类型" }, { status: 400 });

    await ensureLearningSchema();

    // 确定目标学生：指定班级 → 班级全体成员；指定名单 → 逐个校验归属
    let targetEmails: string[] = [];
    let classId: number | null = body.classId ? Number(body.classId) : null;
    if (classId) {
      const cls = await getClass(classId);
      if (!cls || cls.teacher_email !== auth.email) {
        return NextResponse.json({ error: "班级不存在或无权访问" }, { status: 403 });
      }
      const data = await listClassStudents(classId, auth.email);
      targetEmails = data ? data.students.map((s: any) => s.user_email) : [];
    } else if (Array.isArray(body.targetEmails)) {
      const allowed = new Set(await listTeacherStudentEmails(auth.email));
      targetEmails = (body.targetEmails as string[]).map((e) => String(e).toLowerCase()).filter((e) => allowed.has(e));
      if (targetEmails.length === 0) {
        return NextResponse.json({ error: "所选学生均不在你负责的班级内" }, { status: 400 });
      }
    }
    if (targetEmails.length === 0) {
      return NextResponse.json({ error: "请选择目标班级或学生" }, { status: 400 });
    }

    const input: TaskInput = {
      title,
      description: String(body.description || ""),
      type,
      teacherEmail: auth.email,
      classId,
      targetEmails,
      knowledgeNodeIds: Array.isArray(body.knowledgeNodeIds) ? body.knowledgeNodeIds.map(String) : [],
      questions: Array.isArray(body.questions) ? body.questions : [],
      observeItems: Array.isArray(body.observeItems) ? body.observeItems.map(String) : [],
      promptQuestions: Array.isArray(body.promptQuestions) ? body.promptQuestions.map(String) : [],
      deadline: body.deadline ? String(body.deadline) : null,
    };

    if (type === "PRACTICE" && input.questions.length === 0) {
      return NextResponse.json({ error: "练习任务至少需要一道题目" }, { status: 400 });
    }

    const task = await createTask(input);
    await logAudit({ operatorEmail: auth.email, action: "TASK_CREATE", targetType: "task", targetId: String(task.id), detail: `${type}:${title}` });
    // 通知：新任务（异步触发，不阻塞创建）
    const notifyType = type === "REMEDIAL" ? "REMEDIAL_ASSIGNED" : "TASK_ASSIGNED";
    for (const em of targetEmails) {
      addNotification({
        userEmail: em,
        type: notifyType,
        title: type === "REMEDIAL" ? `教师布置了补充学习：${title}` : `新任务：${title}`,
        body: input.description.slice(0, 80),
        link: `/tasks/${task.id}`,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true, task });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
