import { NextRequest, NextResponse } from "next/server";
import { verify } from "jsonwebtoken";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface AuthUser {
  ok: boolean;
  email: string;
  role: string | null;
}

/**
 * 共享的后端鉴权 helper。现有各 API 路由内联了各自的 verifyUser，
 * 本文件仅供新增的外围功能路由使用（不重构旧路由）。
 *
 * 自修 bug 轮起 verifyUser 会查库核对账号当前状态：
 * 停用（status='disabled'）、密码重置（token_version 变更）、角色变更后，
 * 已签发的旧 JWT 立即失效（此前只有 /api/auth/me 校验 tv，其余接口形同虚设）。
 */
export async function verifyUser(req: NextRequest): Promise<AuthUser> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const jwtSecret = process.env.JWT_SECRET;
  if (!token || !jwtSecret) return { ok: false, email: "", role: null };
  try {
    const payload = verify(token, jwtSecret) as { email?: string; role?: string; tv?: number };
    if (!payload.email) return { ok: false, email: "", role: null };
    try {
      const { rows } = await pool.query(
        "SELECT email, role, status, token_version FROM users WHERE email = $1 OR phone = $1 LIMIT 1",
        [payload.email],
      );
      const u = rows[0];
      if (!u || u.status === "disabled") return { ok: false, email: "", role: null };
      if (Number(u.token_version ?? 0) !== Number(payload.tv ?? 0)) return { ok: false, email: "", role: null };
      return { ok: true, email: u.email, role: u.role };
    } catch {
      // users 表尚不存在（全新库首启）时退回仅验签名的旧行为
      return { ok: true, email: payload.email, role: payload.role ?? null };
    }
  } catch {
    return { ok: false, email: "", role: null };
  }
}

export function unauthorized() {
  return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "无权限访问" }, { status: 403 });
}

/** 要求教师角色（admin 视为只读教师放行）；返回 null 表示通过，否则返回应直接回给客户端的 Response */
export async function requireTeacher(req: NextRequest): Promise<{ auth: AuthUser; resp: NextResponse | null }> {
  const auth = await verifyUser(req);
  if (!auth.ok) return { auth, resp: unauthorized() };
  if (auth.role !== "teacher" && auth.role !== "admin") return { auth, resp: forbidden() };
  return { auth, resp: null };
}

/** 要求已登录（学生或教师）；返回 null 表示通过 */
export async function requireUser(req: NextRequest): Promise<{ auth: AuthUser; resp: NextResponse | null }> {
  const auth = await verifyUser(req);
  if (!auth.ok) return { auth, resp: unauthorized() };
  return { auth, resp: null };
}

/** 要求 Admin 角色；返回 null 表示通过 */
export async function requireAdmin(req: NextRequest): Promise<{ auth: AuthUser; resp: NextResponse | null }> {
  const auth = await verifyUser(req);
  if (!auth.ok) return { auth, resp: unauthorized() };
  if (auth.role !== "admin") return { auth, resp: forbidden() };
  return { auth, resp: null };
}
