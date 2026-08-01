import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { compare } from "bcryptjs";
import { sign } from "jsonwebtoken";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(req: NextRequest) {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return NextResponse.json({ error: "服务端尚未配置 JWT_SECRET" }, { status: 500 });
    }
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "缺少邮箱或密码" }, { status: 400 });
    }

    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
    }

    const user = rows[0];
    const valid = await compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
    }

    await pool.query("UPDATE users SET last_login = now() WHERE id = $1", [user.id]);

    const token = sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      jwtSecret,
      { expiresIn: "7d" }
    );

    return NextResponse.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
