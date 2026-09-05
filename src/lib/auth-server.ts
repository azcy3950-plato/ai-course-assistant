import { NextRequest, NextResponse } from "next/server";
import { verify } from "jsonwebtoken";

export interface AuthUser {
  ok: boolean;
  email: string;
  role: string | null;
}

/**
 * 共享的后端鉴权 helper。现有各 API 路由内联了各自的 verifyUser，
 * 本文件仅供本轮新增的教师端/学生端外围功能路由使用（不重构旧路由）。
 */
export function verifyUser(req: NextRequest): AuthUser {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const jwtSecret = process.env.JWT_SECRET;
  if (!token || !jwtSecret) return { ok: false, email: "", role: null };
  try {
    const payload = verify(token, jwtSecret) as { email?: string; role?: string };
    if (!payload.email) return { ok: false, email: "", role: null };
    return { ok: true, email: payload.email, role: payload.role ?? null };
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

/** 要求教师角色；返回 null 表示通过，否则返回应直接回给客户端的 Response */
export function requireTeacher(req: NextRequest): { auth: AuthUser; resp: NextResponse | null } {
  const auth = verifyUser(req);
  if (!auth.ok) return { auth, resp: unauthorized() };
  if (auth.role !== "teacher") return { auth, resp: forbidden() };
  return { auth, resp: null };
}

/** 要求已登录（学生或教师）；返回 null 表示通过 */
export function requireUser(req: NextRequest): { auth: AuthUser; resp: NextResponse | null } {
  const auth = verifyUser(req);
  if (!auth.ok) return { auth, resp: unauthorized() };
  return { auth, resp: null };
}

/** 要求 Admin 角色；返回 null 表示通过 */
export function requireAdmin(req: NextRequest): { auth: AuthUser; resp: NextResponse | null } {
  const auth = verifyUser(req);
  if (!auth.ok) return { auth, resp: unauthorized() };
  if (auth.role !== "admin") return { auth, resp: forbidden() };
  return { auth, resp: null };
}
