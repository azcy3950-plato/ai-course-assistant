import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-server";
import { pool, ensureLearningSchema } from "@/lib/learning-db";
import { logAudit } from "@/lib/audit";

/** Admin 专属：授予/取消教师角色（普通教师 403） */
export async function POST(req: NextRequest) {
  const { auth, resp } = requireAdmin(req);
  if (resp) return resp;
  try {
    const { email, role } = await req.json().catch(() => ({}));
    const target = String(email || "").trim().toLowerCase();
    if (!target || !["teacher", "student"].includes(role)) {
      return NextResponse.json({ error: "参数无效" }, { status: 400 });
    }
    await ensureLearningSchema();
    const upd = await pool.query("UPDATE users SET role = $2 WHERE email = $1", [target, role]);
    if ((upd.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    }
    await logAudit({
      operatorEmail: auth.email,
      action: role === "teacher" ? "GRANT_TEACHER" : "REVOKE_TEACHER",
      targetType: "user",
      targetId: target,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
