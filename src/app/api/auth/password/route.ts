import { NextRequest, NextResponse } from "next/server";
import { verify } from "jsonwebtoken";
import { compare, hash } from "bcryptjs";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function PUT(req: NextRequest) {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return NextResponse.json({ error: "服务端尚未配置 JWT_SECRET" }, { status: 500 });
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    let decoded: any;
    try { decoded = verify(token, jwtSecret); } catch { return NextResponse.json({ error: "登录已过期" }, { status: 401 }); }

    const body = await req.json().catch(() => ({}));
    const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!oldPassword || newPassword.length < 6) {
      return NextResponse.json({ error: "请填写旧密码,新密码至少 6 位" }, { status: 400 });
    }
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [decoded.id]);
    if (rows.length === 0) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    const ok = await compare(oldPassword, rows[0].password_hash);
    if (!ok) {
      // 防在线暴力尝试:失败延迟 500ms(bcrypt 之上再加一道节流)
      await new Promise(r => setTimeout(r, 500));
      return NextResponse.json({ error: "旧密码不正确" }, { status: 400 });
    }
    const passwordHash = await hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, decoded.id]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
