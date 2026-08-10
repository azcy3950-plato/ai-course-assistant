import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { verify as jwtVerify } from "jsonwebtoken";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function getUser(req: NextRequest): { email: string; role: string } | null {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return null;
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return null;
    const payload = jwtVerify(token, jwtSecret) as { email?: string; role?: string };
    if (!payload.email) return null;
    return { email: payload.email, role: payload.role || "student" };
  } catch {
    return null;
  }
}

// 教师开通教师账号:仅 teacher 可调用,仅可将 student 提升为 teacher(不可降级、不可自操作)
export async function POST(req: NextRequest) {
  try {
    const user = getUser(req);
    if (!user) return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
    if (user.role !== "teacher") return NextResponse.json({ error: "仅教师可开通教师账号" }, { status: 403 });

    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "请输入有效的邮箱地址" }, { status: 400 });
    }
    if (email === user.email) {
      return NextResponse.json({ error: "你已是教师,无需操作" }, { status: 400 });
    }

    const { rows } = await pool.query(
      "UPDATE users SET role = 'teacher' WHERE email = $1 AND role = 'student' RETURNING email",
      [email]
    );
    if (rows.length === 0) {
      const { rows: existing } = await pool.query(
        "SELECT role FROM users WHERE email = $1",
        [email]
      );
      if (existing.length === 0) {
        return NextResponse.json({ error: "该邮箱尚未注册" }, { status: 404 });
      }
      return NextResponse.json({ error: "该账号已是教师" }, { status: 409 });
    }

    console.log(`[admin/promote] ${user.email} promoted ${email} to teacher`);
    return NextResponse.json({ ok: true, email });
  } catch (err: any) {
    console.error("[admin/promote]:", err?.message || err);
    return NextResponse.json({ error: "服务暂时不可用,请稍后重试" }, { status: 500 });
  }
}
