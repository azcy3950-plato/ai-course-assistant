import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-server";
import { pool, ensureLearningSchema } from "@/lib/learning-db";
import { logAudit } from "@/lib/audit";

/** Admin 专属：账号管理（列表/删除）。删除为软删：status='disabled'，登录与接口均拒绝。 */
export async function GET(req: NextRequest) {
  const { auth, resp } = requireAdmin(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'").catch(() => {});
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    const { rows } = await pool.query(
      `SELECT id, email, name, role, status, created_at, last_login
       FROM users WHERE email ILIKE $1 OR name ILIKE $1 ORDER BY created_at DESC LIMIT 100`,
      [like],
    );
    return NextResponse.json({ users: rows.map((u) => ({ ...u, email: u.email })) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { auth, resp } = requireAdmin(req);
  if (resp) return resp;
  try {
    const { email } = await req.json().catch(() => ({}));
    const target = String(email || "").trim().toLowerCase();
    if (!target) return NextResponse.json({ error: "缺少邮箱" }, { status: 400 });
    if (target === auth.email) return NextResponse.json({ error: "不能删除自己" }, { status: 400 });
    await ensureLearningSchema();
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'").catch(() => {});
    const upd = await pool.query("UPDATE users SET status = 'disabled' WHERE email = $1", [target]);
    if ((upd.rowCount ?? 0) === 0) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    await logAudit({ operatorEmail: auth.email, action: "DELETE_ACCOUNT", targetType: "user", targetId: target });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
