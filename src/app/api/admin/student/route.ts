import { NextRequest, NextResponse } from "next/server";
import { verify } from "jsonwebtoken";
import { hash } from "bcryptjs";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function getTeacher(req: NextRequest): { email: string } | null {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const jwtSecret = process.env.JWT_SECRET;
  if (!token || !jwtSecret) return null;
  try {
    const payload = verify(token, jwtSecret) as { email?: string; role?: string };
    return payload.email && payload.role === "teacher" ? { email: payload.email } : null;
  } catch { return null; }
}

// 教师管理学生账号:改名(PATCH)/重置密码(PUT)/删除(DELETE);仅可操作 role=student 账号
export async function PATCH(req: NextRequest) {
  try {
    if (!getTeacher(req)) return NextResponse.json({ error: "仅教师可操作" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!email || !name || name.length > 30) return NextResponse.json({ error: "参数无效" }, { status: 400 });
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
  try {
    if (!getTeacher(req)) return NextResponse.json({ error: "仅教师可操作" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const newPassword = typeof body.password === "string" ? body.password : "";
    if (!email || newPassword.length < 6) return NextResponse.json({ error: "邮箱无效或新密码不足 6 位" }, { status: 400 });
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
  try {
    if (!getTeacher(req)) return NextResponse.json({ error: "仅教师可操作" }, { status: 403 });
    const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase() || "";
    if (!email) return NextResponse.json({ error: "缺少邮箱参数" }, { status: 400 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // 事务内:先清理子表再删用户(避免部分成功窗口)
      await client.query("DELETE FROM learning_records WHERE user_email = $1", [email]);
      await client.query("DELETE FROM quiz_results WHERE user_email = $1", [email]);
      await client.query("DELETE FROM student_node_progress WHERE user_email = $1", [email]);
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
