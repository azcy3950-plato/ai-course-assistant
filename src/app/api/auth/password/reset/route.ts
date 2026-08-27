import { NextRequest, NextResponse } from "next/server";
import { verify as jwtVerify } from "jsonwebtoken";
import { hash } from "bcryptjs";
import { Pool } from "pg";
import {
  ensureAuthSchema,
  normalizeIdentifier,
  maskIdentifier,
  auditEvent,
} from "@/lib/auth-identifiers";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** 找回密码第 3 步：校验 resetToken 后设置新密码，并使该用户现有登录失效 */
export async function POST(req: NextRequest) {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return NextResponse.json({ error: "服务端尚未配置 JWT_SECRET" }, { status: 500 });
    }
    const body = await req.json().catch(() => ({}));
    const resetToken = typeof body.resetToken === "string" ? body.resetToken : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    const normalized = normalizeIdentifier(body.identifier);
    if (!normalized || !resetToken) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return NextResponse.json({ error: "密码至少 8 位，且需同时包含字母和数字" }, { status: 400 });
    }

    let payload: any;
    try {
      payload = jwtVerify(resetToken, jwtSecret);
    } catch {
      return NextResponse.json({ error: "验证码错误或已失效" }, { status: 400 });
    }
    if (payload?.purpose !== "RESET_PASSWORD" || payload?.identifier !== normalized.identifier || !payload?.codeHash) {
      return NextResponse.json({ error: "验证码错误或已失效" }, { status: 400 });
    }

    await ensureAuthSchema();

    // 已验证且未用于重置、未过期的验证码记录才有效（一次性）
    const { rows } = await pool.query(
      `SELECT * FROM verification_codes
       WHERE identifier = $1 AND purpose = 'RESET_PASSWORD' AND code_hash = $2
         AND consumed_at IS NOT NULL AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [normalized.identifier, payload.codeHash],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "验证码错误或已失效" }, { status: 400 });
    }
    const codeRow = rows[0];

    const passwordHash = await hash(newPassword, 10);
    const upd = await pool.query(
      "UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE email = $1 OR phone = $1",
      [normalized.identifier, passwordHash],
    );
    if ((upd.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: "账号不存在" }, { status: 400 });
    }

    // 一次性消费：同一验证码/凭证不可再次用于重置
    await pool.query("UPDATE verification_codes SET used_at = now() WHERE id = $1", [codeRow.id]);
    await auditEvent("PASSWORD_RESET_SUCCESS", maskIdentifier(normalized.identifier, normalized.type));

    return NextResponse.json({ ok: true, message: "密码已重置，请重新登录" });
  } catch (err: any) {
    console.error('[auth/password/reset]:', err?.message || err);
    return NextResponse.json({ error: "重置服务暂时不可用，请稍后重试" }, { status: 500 });
  }
}
