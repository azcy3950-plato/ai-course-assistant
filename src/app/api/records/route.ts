import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const email = sp.get("email") || "";
  if (!email) return NextResponse.json([]);

  const { rows } = await pool.query(
    "SELECT * FROM learning_records WHERE user_email = $1 ORDER BY created_at DESC LIMIT 50",
    [email]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  try {
    const { user_email, question, answer_summary, keywords, topics, has_references } = await req.json();
    await pool.query(
      "INSERT INTO learning_records (user_email, question, answer_summary, keywords, topics, has_references) VALUES ($1,$2,$3,$4,$5,$6)",
      [user_email, question, answer_summary, keywords || [], topics || [], has_references || false]
    );
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
