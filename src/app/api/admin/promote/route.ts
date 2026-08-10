import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { verify as jwtVerify } from "jsonwebtoken";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 审计表只建一次(模块级缓存,避免每请求 DDL)
let auditTableReady: Promise<void> | null = null;
function ensureAuditTable(): Promise<void> {
  if (!auditTableReady) {
    auditTableReady = pool
      .query(
        `CREATE TABLE IF NOT EXISTS admin_audit (
          id SERIAL PRIMARY KEY,
          actor_email TEXT NOT NULL,
          action TEXT NOT NULL,
          target_email TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      )
      .then(() => undefined);
  }
  return auditTableReady;
}

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
// 提权与审计在同一事务:审计写入失败则回滚,角色不会提升且无记录
export async function POST(req: NextRequest) {
  const client = await pool.connect();
  try {
    const user = getUser(req);
    if (!user) return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
    if (user.role !== "teacher") return NextResponse.json({ error: "仅教师可开通教师账号" }, { status: 403 });

    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "请输入有效的邮箱地址" }, { status: 400 });
    }
    if (email === user.email.toLowerCase()) {
      return NextResponse.json({ error: "你已是教师,无需操作" }, { status: 400 });
    }

    await ensureAuditTable();
    await client.query("BEGIN");
    try {
      const { rows } = await client.query(
        "UPDATE users SET role = 'teacher' WHERE email = $1 AND role = 'student' RETURNING email",
        [email]
      );
      if (rows.length === 0) {
        const { rows: existing } = await client.query(
          "SELECT role FROM users WHERE email = $1",
          [email]
        );
        if (existing.length === 0) {
          // 防邮箱枚举:未注册与已是教师返回同状态同文案
          await client.query(
            "INSERT INTO admin_audit (actor_email, action, target_email) VALUES ($1, $2, $3)",
            [user.email, "promote_not_found", email]
          );
          await client.query("COMMIT");
          return NextResponse.json({ ok: false, error: "该邮箱未注册或已是教师,无法开通" }, { status: 200 });
        }
        await client.query(
          "INSERT INTO admin_audit (actor_email, action, target_email) VALUES ($1, $2, $3)",
          [user.email, "promote_already", email]
        );
        await client.query("COMMIT");
        return NextResponse.json({ ok: false, error: "该邮箱未注册或已是教师,无法开通" }, { status: 200 });
      }

      await client.query(
        "INSERT INTO admin_audit (actor_email, action, target_email) VALUES ($1, $2, $3)",
        [user.email, "promote_ok", email]
      );
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, email });
    } catch (inner: any) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw inner;
    }
  } catch (err: any) {
    console.error("[admin/promote]:", err?.message || err);
    return NextResponse.json({ error: "服务暂时不可用,请稍后重试" }, { status: 500 });
  } finally {
    client.release();
  }
}
