import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { compare } from "bcryptjs";
import { sign } from "jsonwebtoken";
import { ensureAuthSchema, normalizeIdentifier, maskIdentifier, auditEvent } from "@/lib/auth-identifiers";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── 登录失败节流（内存实现，pm2 restart 即重置；与验证码限流同模式） ───
// 防在线暴力破解：同一 IP+账号 15 分钟内失败 ≥10 次 → 429；单次失败响应前延迟 500ms。
// 成功登录不受影响（E2E 大量成功登录不会被误伤）。
const loginFailures = new Map<string, { count: number; windowStart: number }>();
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_MAX = 10;

function checkLoginThrottle(key: string): boolean {
  const now = Date.now();
  const rec = loginFailures.get(key);
  if (!rec) return false;
  if (now - rec.windowStart > FAIL_WINDOW_MS) { loginFailures.delete(key); return false; }
  return rec.count >= FAIL_MAX;
}

function recordLoginFailure(key: string) {
  const now = Date.now();
  const rec = loginFailures.get(key);
  if (!rec || now - rec.windowStart > FAIL_WINDOW_MS) loginFailures.set(key, { count: 1, windowStart: now });
  else rec.count += 1;
}

/**
 * 邮箱登录（兼容旧前端传 email 字段）。
 * 短信/手机号通道已于 2026-08 停用：账号体系收敛为邮箱唯一标识。
 */
export async function POST(req: NextRequest) {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return NextResponse.json({ error: "服务端尚未配置 JWT_SECRET" }, { status: 500 });
    }
    const body = await req.json().catch(() => ({}));
    const raw = typeof body.identifier === "string" ? body.identifier : typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";

    const normalized = normalizeIdentifier(raw);
    if (!normalized || normalized.type !== "EMAIL" || !password) {
      return NextResponse.json({ error: "请输入正确的邮箱地址" }, { status: 400 });
    }
    const { identifier, type } = normalized;

    const clientIp = (req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || "unknown";
    const throttleKey = `${clientIp}|${identifier}`;
    if (checkLoginThrottle(throttleKey)) {
      return NextResponse.json({ error: "登录失败次数过多，请 15 分钟后再试" }, { status: 429 });
    }

    await ensureAuthSchema();
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1 OR phone = $1 LIMIT 1", [identifier]);
    if (rows.length === 0) {
      recordLoginFailure(throttleKey);
      await new Promise((r) => setTimeout(r, 500));
      await auditEvent("LOGIN_FAILED", maskIdentifier(identifier, type), "account_not_found");
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 });
    }

    const user = rows[0];
    if (user.status === "disabled") {
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 });
    }
    const valid = await compare(password, user.password_hash);
    if (!valid) {
      recordLoginFailure(throttleKey);
      await new Promise((r) => setTimeout(r, 500));
      await auditEvent("LOGIN_FAILED", maskIdentifier(identifier, type), "wrong_password");
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 });
    }

    loginFailures.delete(throttleKey);
    await pool.query("UPDATE users SET last_login = now() WHERE id = $1", [user.id]);
    await auditEvent("LOGIN_SUCCESS", maskIdentifier(identifier, type));

    const accountKey = user.email ?? user.phone ?? identifier;
    const token = sign(
      { id: user.id, email: accountKey, name: user.name, role: user.role, tv: Number(user.token_version ?? 0) },
      jwtSecret,
      { expiresIn: "7d" },
    );

    return NextResponse.json({
      token,
      user: { id: user.id, email: accountKey, name: user.name, role: user.role },
    });
  } catch (err: any) {
    console.error('[auth/login]:', err?.message || err);
    return NextResponse.json({ error: "登录服务暂时不可用，请稍后重试" }, { status: 500 });
  }
}
