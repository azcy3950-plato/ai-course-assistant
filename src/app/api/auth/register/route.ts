import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { hash } from "bcryptjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(req: NextRequest) {
  try {
    const { email, password, name, role } = await req.json();
    if (!email || !password || !name) {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "密码至少6位" }, { status: 400 });
    }

    const { rows } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (rows.length > 0) {
      return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
    }

    const passwordHash = await hash(password, 10);
    const { rows: newUser } = await pool.query(
      "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role",
      [email, passwordHash, name, role || "student"]
    );

    return NextResponse.json({ user: newUser[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
