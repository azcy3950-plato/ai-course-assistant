import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { verify as jwtVerify } from "jsonwebtoken";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 严格鉴权:解析 JWT 邮箱,无效即 401
function getUserEmail(req: NextRequest): string {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const jwtSecret = process.env.JWT_SECRET;
  if (!token || !jwtSecret) return "";
  try {
    return (jwtVerify(token, jwtSecret) as { email?: string }).email || "";
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  const me = getUserEmail(req);
  if (!me) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  // 只能查询自己的记录,防枚举他人数据
  const email = me;

  try {
    const { rows } = await pool.query(
      "SELECT * FROM learning_records WHERE user_email = $1 ORDER BY created_at DESC LIMIT 50",
      [email]
    );
    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('[records] GET:', err?.message || err);
    return NextResponse.json({ error: "学习记录服务暂时不可用" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = getUserEmail(req);
    if (!me) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const { question, answer_summary, keywords, topics, has_references } = await req.json();
    // 强制写自己的记录,忽略客户端传入的 user_email
    const user_email = me;
    await pool.query(
      "INSERT INTO learning_records (user_email, question, answer_summary, keywords, topics, has_references) VALUES ($1,$2,$3,$4,$5,$6)",
      [user_email, question, answer_summary, keywords || [], topics || [], has_references || false]
    );
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[records] POST:', err?.message || err);
    return NextResponse.json({ error: "学习记录保存失败，请稍后重试" }, { status: 500 });
  }
}
