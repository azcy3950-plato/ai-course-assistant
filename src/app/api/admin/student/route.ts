import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { Pool } from "pg";
import { requireTeacher } from "@/lib/auth-server";
import { ensureLearningSchema, canTeacherViewStudent } from "@/lib/learning-db";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 教师管理学生账号:改名(PATCH)/重置密码(PUT)/删除(DELETE);仅可操作 role=student 账号。
// 归属校验：教师只能操作本班学生（canTeacherViewStudent）；admin 保留全局权限（账号管理职责）。
export async function PATCH(req: NextRequest) {
  const { auth, resp } = await requireTeacher(req);
  if (resp) return resp;
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!email || !name || name.length > 30) return NextResponse.json({ error: "参数无效" }, { status: 400 });
    const allowed = await ensureStudentAccess(auth, email);
    if (allowed) return allowed;
    const { rows } = await pool.query(
      "UPDATE users SET name = $1 WHERE email = $2 AND role = 'student' RETURNING id, email, name",
      [name, email],
    );
    if (!rows.length) return NextResponse.json({ error: "未找到该学生账号" }, { status: 404 });
    return NextResponse.json({ ok: true, student: rows[0] });
  } catch (err: any) {
    console.error('[admin/student] PATCH:', err?.message || err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const { auth, resp } = await requireTeacher(req);
  if (resp) return resp;
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const newPassword = typeof body.password === "string" ? body.password : "";
    if (!email || newPassword.length < 6) return NextResponse.json({ error: "邮箱无效或新密码不足 6 位" }, { status: 400 });
    const allowed = await ensureStudentAccess(auth, email);
    if (allowed) return allowed;
    const passwordHash = await hash(newPassword, 10);
    const { rows } = await pool.query(
      "UPDATE users SET password_hash = $1 WHERE email = $2 AND role = 'student' RETURNING id, email",
      [passwordHash, email],
    );
    if (!rows.length) return NextResponse.json({ error: "未找到该学生账号" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[admin/student] PUT:', err?.message || err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { auth, resp } = await requireTeacher(req);
  if (resp) return resp;
  try {
    const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase() || "";
    if (!email) return NextResponse.json({ error: "缺少邮箱参数" }, { status: 400 });
    const allowed = await ensureStudentAccess(auth, email);
    if (allowed) return allowed;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // 事务内:先清理子表再删用户(避免部分成功窗口)
      await client.query("DELETE FROM teacher_feedback WHERE submission_id IN (SELECT id FROM task_submissions WHERE user_email = $1)", [email]);
      await client.query("DELETE FROM task_attachments WHERE submission_id IN (SELECT id FROM task_submissions WHERE user_email = $1)", [email]);
      await client.query("DELETE FROM task_submissions WHERE user_email = $1", [email]);
      await client.query("DELETE FROM student_tasks WHERE user_email = $1", [email]);
      await client.query("DELETE FROM class_members WHERE user_email = $1", [email]);
      await client.query("DELETE FROM direct_messages WHERE student_email = $1 OR sender_email = $1", [email]);
      for (const table of ["practice_corrections", "quiz_results", "learning_events", "ai_qa_messages", "learning_records", "student_node_progress", "notifications", "favorites"]) {
        await client.query(`DELETE FROM ${table} WHERE user_email = $1`, [email]);
      }
      const { rows } = await client.query(
        "DELETE FROM users WHERE email = $1 AND role = 'student' RETURNING id, email",
        [email],
      );
      if (!rows.length) { await client.query("ROLLBACK"); return NextResponse.json({ error: "未找到该学生账号" }, { status: 404 }); }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[admin/student] DELETE:', err?.message || err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

/** 归属校验：admin 全局放行；教师仅限本班学生。返回 null 表示通过，否则返回应回给客户端的 403 */
async function ensureStudentAccess(
  auth: { email: string; role: string | null },
  studentEmail: string,
): Promise<NextResponse | null> {
  await ensureLearningSchema().catch(() => {});
  if (auth.role === "admin") return null;
  const ok = await canTeacherViewStudent(auth.email, studentEmail).catch(() => false);
  if (!ok) return NextResponse.json({ error: "该学生不在您的班级中" }, { status: 403 });
  return null;
}
