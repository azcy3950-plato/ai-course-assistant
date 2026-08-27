import { NextRequest, NextResponse } from "next/server";
import { verify } from "jsonwebtoken";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getUser(req: NextRequest): Promise<{ id: string; email: string; name: string; role: string } | null> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return null;
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "");
  if (!token) return null;
  try {
    return verify(token, jwtSecret) as any;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  try {
    const decoded = await getUser(req);
    if (!decoded) return NextResponse.json({ error: "未登录" }, { status: 401 });
    // 从库取最新 name/avatar(改名/传头像后 JWT 内旧值不生效)
    const { rows } = await pool.query(
      "SELECT id, email, phone, name, role, avatar, token_version FROM users WHERE id = $1",
      [decoded.id],
    );
    if (rows.length === 0) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    const u = rows[0];
    // 密码重置后 token_version 递增：旧会话立即失效
    if (Number(u.token_version ?? 0) !== Number((decoded as any).tv ?? 0)) {
      return NextResponse.json({ error: "登录已失效，请重新登录" }, { status: 401 });
    }
    return NextResponse.json({ user: { id: u.id, email: u.email ?? u.phone, name: u.name, role: u.role, avatar: u.avatar } });
  } catch (err: any) {
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const decoded = await getUser(req);
    if (!decoded) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 30) return NextResponse.json({ error: "姓名需为 1-30 个字符" }, { status: 400 });
    const { rows } = await pool.query("UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name", [name, decoded.id]);
    if (rows.length === 0) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    return NextResponse.json({ ok: true, name: rows[0].name });
  } catch (err: any) {
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
