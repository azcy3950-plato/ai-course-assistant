import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { hash } from "bcryptjs";
import {
  ensureAuthSchema,
  normalizeIdentifier,
  maskIdentifier,
  consumeVerificationCode,
  auditEvent,
} from "@/lib/auth-identifiers";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** 注册：手机号或邮箱 + 验证码（先发码后注册），一律注册为学生 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const raw = typeof body.identifier === "string" ? body.identifier : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";

    const normalized = normalizeIdentifier(raw);
    if (!normalized || normalized.type !== "EMAIL") {
      return NextResponse.json({ error: "请输入正确的邮箱地址" }, { status: 400 });
    }
    const { identifier, type } = normalized;
    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "请输入 6 位验证码" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "请填写姓名" }, { status: 400 });
    }
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      return NextResponse.json({ error: "密码至少 8 位，且需同时包含字母和数字" }, { status: 400 });
    }

    await ensureAuthSchema();

    // 重复账号：注册场景允许明确提示
    const dup = await pool.query("SELECT 1 FROM users WHERE email = $1 OR phone = $1 LIMIT 1", [identifier]);
    if ((dup.rowCount ?? 0) > 0) {
      const label = type === "EMAIL" ? "该邮箱已注册" : "该手机号已注册";
      return NextResponse.json({ error: `${label}，请直接登录或找回密码` }, { status: 409 });
    }

    const verified = await consumeVerificationCode(identifier, type, "REGISTER", code);
    if (!verified) {
      return NextResponse.json({ error: "验证码错误或已失效" }, { status: 400 });
    }

    // 一律注册为学生：教师账号由管理员开通，防自注册越权
    const safeRole = "student";
    const passwordHash = await hash(password, 10);
    const { rows: newUser } = await pool.query(
      "INSERT INTO users (email, phone, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, phone, name, role",
      [type === "EMAIL" ? identifier : null, type === "PHONE" ? identifier : null, passwordHash, name, safeRole],
    );

    await auditEvent("REGISTER_SUCCESS", maskIdentifier(identifier, type));
    return NextResponse.json({ user: newUser[0] });
  } catch (err: any) {
    console.error('[auth/register]:', err?.message || err);
    return NextResponse.json({ error: "注册服务暂时不可用，请稍后重试" }, { status: 500 });
  }
}
