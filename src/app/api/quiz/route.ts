import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { loadKnowledgeGraph, recordQuizResultByTopic } from "@/lib/knowledge-graph";

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

    const graph = await loadKnowledgeGraph(email);
    const recentNodeIds = new Set<string>(recent.flatMap((record: any) => Array.isArray(record.topics) ? record.topics : []));
    const allowedNodes = graph.nodes.filter((node) => recentNodeIds.has(node.id));
    const quizNodes = allowedNodes.length ? allowedNodes : graph.nodes.slice(0, 5);
    const recordsInfo = recent.map((record: any) => ({ question: record.question, nodeIds: record.topics }));
    const prompt =
      "你是课程小测生成器。题目只能使用下列知识图谱数据库节点，不得生成新节点或虚构课程资料。\n" +
      "允许节点：\n" + quizNodes.map((node) => `${node.id}｜${node.name}｜${node.description}`).join("\n") +
      "\n近期学习记录：\n" + JSON.stringify(recordsInfo) +
      "\n生成2道四选一中文题。只输出合法JSON数组：" +
      '[{"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"correct":"A","explanation":"...","topic":"数据库节点名称","nodeId":"数据库节点ID"}]';

    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + DEEPSEEK_KEY },
      body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: prompt }], max_tokens: 1024, temperature: 0.7 }),
    });
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || "[]").replace(/```json|```/g, "").trim();
    const rawQuestions = JSON.parse(text);
    const allowedById = new Map(quizNodes.map((node) => [node.id, node]));
    const questions = (Array.isArray(rawQuestions) ? rawQuestions : []).flatMap((question: any) => {
      const node = allowedById.get(question.nodeId);
      if (!node || !Array.isArray(question.options) || question.options.length !== 4) return [];
      return [{ ...question, topic: node.name, nodeId: node.id }];
    });

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
    await recordQuizResultByTopic(user_email, topic, Boolean(is_correct));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
