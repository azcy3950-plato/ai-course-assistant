import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { verify as jwtVerify } from "jsonwebtoken";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 严格鉴权:解析 JWT 邮箱与角色,无效即 401
function getUser(req: NextRequest): { email: string; role: string } | null {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const jwtSecret = process.env.JWT_SECRET;
  if (!token || !jwtSecret) return null;
  try {
    const payload = jwtVerify(token, jwtSecret) as { email?: string; role?: string };
    if (!payload.email) return null;
    return { email: payload.email, role: payload.role || "student" };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const sp = new URL(req.url).searchParams;
    const requested = sp.get("email") || "";
    let rows;
    if (user.role === "teacher") {
      // 教师可查全部(或指定学生)的小测结果
      const { rows: r } = requested
        ? await pool.query("SELECT * FROM quiz_results WHERE user_email = $1 ORDER BY created_at DESC LIMIT 200", [requested])
        : await pool.query("SELECT * FROM quiz_results ORDER BY created_at DESC LIMIT 200");
      rows = r;
    } else {
      // 学生只能查自己的
      const { rows: r } = await pool.query("SELECT * FROM quiz_results WHERE user_email = $1 ORDER BY created_at DESC LIMIT 200", [user.email]);
      rows = r;
    }
    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('[quiz-results] GET:', err?.message || err);
    return NextResponse.json({ error: "小测结果服务暂时不可用" }, { status: 500 });
  }
}
