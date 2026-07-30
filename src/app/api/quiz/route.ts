import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const email = sp.get("email") || "";
    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

    const { rows: cnt } = await pool.query(
      "SELECT COUNT(*) as c FROM learning_records WHERE user_email = $1 AND created_at > COALESCE((SELECT MAX(created_at) FROM quiz_results WHERE user_email = $1), '1970-01-01'::timestamptz)",
      [email]
    );
    const recordCount = parseInt(cnt[0]?.c || "0");

    const { rows: recent } = await pool.query(
      "SELECT question, answer_summary, topics, keywords FROM learning_records WHERE user_email = $1 ORDER BY created_at DESC LIMIT 5",
      [email]
    );

    const needsQuiz = recordCount >= 5;
    if (!needsQuiz) {
      return NextResponse.json({ needsQuiz: false, recordCount, nextAt: 5 - recordCount });
    }

    const recordsInfo = recent.map((r: any) => ({ question: r.question, topics: r.topics }));
    const prompt = "Based on these student learning records, generate 2 multiple-choice questions (4 options each, in Chinese):\n" +
      JSON.stringify(recordsInfo) +
      "\n\nOutput ONLY valid JSON array: [{\"question\":\"...\",\"options\":[\"A...\",\"B...\",\"C...\",\"D...\"],\"correct\":\"A\",\"explanation\":\"...\",\"topic\":\"...\"}]";

    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + DEEPSEEK_KEY },
      body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: prompt }], max_tokens: 1024, temperature: 0.7 }),
    });
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || "[]").replace(/```json|```/g, "").trim();
    const questions = JSON.parse(text);

    return NextResponse.json({ needsQuiz: true, recordCount, questions });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user_email, question, student_answer, correct_answer, is_correct, topic } = await req.json();
    await pool.query(
      "INSERT INTO quiz_results (user_email, question, correct_answer, student_answer, is_correct, topic) VALUES ($1,$2,$3,$4,$5,$6)",
      [user_email, question, correct_answer, student_answer, is_correct, topic]
    );
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
