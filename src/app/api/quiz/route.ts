import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import crypto from "crypto";
import { loadKnowledgeGraph, recordQuizResultByTopic } from "@/lib/knowledge-graph";
import { verify as jwtVerify } from "jsonwebtoken";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

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

// ─── 小测会话（内存，30 分钟过期）：题目与正确答案仅存服务端，客户端拿不到 correct ───
interface QuizQuestion {
  question: string;
  options: string[];
  correct: string; // 字母 A-D
  explanation: string;
  topic: string;
  nodeId: string;
}
interface QuizSession {
  email: string;
  questions: QuizQuestion[];
  expiresAt: number;
}
const quizSessions = new Map<string, QuizSession>();
const SESSION_TTL = 30 * 60 * 1000;

function cleanupSessions() {
  const now = Date.now();
  for (const [k, v] of quizSessions) {
    if (now > v.expiresAt) quizSessions.delete(k);
  }
}

export async function GET(req: NextRequest) {
  try {
    const me = getUserEmail(req);
    if (!me) return NextResponse.json({ error: "未登录" }, { status: 401 });

    // 阶段检测条件：距上次小测 ≥24h 且新增学习记录 ≥8（替代"每5问强制弹窗"）
    const last = await pool.query("SELECT MAX(created_at) AS last_at FROM quiz_results WHERE user_email = $1", [me]);
    const lastAt = last.rows[0]?.last_at ? new Date(last.rows[0].last_at).getTime() : 0;
    const hoursSince = (Date.now() - lastAt) / 3600000;
    const { rows: cnt } = await pool.query(
      "SELECT COUNT(*) as c FROM learning_records WHERE user_email = $1 AND created_at > COALESCE($2::timestamptz, '1970-01-01'::timestamptz)",
      [me, last.rows[0]?.last_at || null],
    );
    const recordCount = parseInt(cnt[0]?.c || "0");
    const needsQuiz = recordCount >= 8 && (lastAt === 0 || hoursSince >= 24);
    if (!needsQuiz) {
      const missingRecords = Math.max(0, 8 - recordCount);
      const missingHours = lastAt === 0 ? 0 : Math.max(0, Math.ceil(24 - hoursSince));
      return NextResponse.json({
        needsQuiz: false,
        recordCount,
        missingRecords,
        hoursSinceLast: Math.round(hoursSince * 10) / 10,
        hint: lastAt === 0 || hoursSince >= 24
          ? `再学习 ${missingRecords} 个新问题后可进行阶段检测`
          : `距上次检测 ${missingHours} 小时后可再次检测`,
      });
    }

    const { rows: recent } = await pool.query(
      "SELECT question, answer_summary, topics, keywords FROM learning_records WHERE user_email = $1 ORDER BY created_at DESC LIMIT 5",
      [me],
    );
    const graph = await loadKnowledgeGraph(me, "all");
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
    if (!res.ok) throw new Error("DeepSeek 生成失败 " + res.status);
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || "[]").replace(/```json|```/g, "").trim();
    const rawQuestions = JSON.parse(text);
    const allowedById = new Map(quizNodes.map((node) => [node.id, node]));
    const questions: QuizQuestion[] = (Array.isArray(rawQuestions) ? rawQuestions : []).flatMap((question: any) => {
      const node = allowedById.get(question.nodeId);
      if (!node || !Array.isArray(question.options) || question.options.length !== 4) return [];
      return [{
        question: question.question,
        options: question.options,
        correct: question.correct,
        explanation: question.explanation || "",
        topic: node.name,
        nodeId: node.id,
      }];
    });

    // 会话落内存，客户端只拿到不含 correct 的题目
    cleanupSessions();
    const token = crypto.randomUUID();
    quizSessions.set(token, { email: me, questions, expiresAt: Date.now() + SESSION_TTL });
    return NextResponse.json({
      needsQuiz: true,
      token,
      questions: questions.map(({ correct: _c, ...rest }) => rest),
    });
  } catch (err: any) {
    console.error('[quiz] GET:', err?.message || err);
    return NextResponse.json({ error: "小测服务暂时不可用" }, { status: 500 });
  }
}

/** 提交：两种模式均服务端判分。
 *  (a) 新小测：{token, answers:[{index, studentAnswer}]}
 *  (b) 错题重做：{question, studentAnswer} —— 按该学生已存行判分（无需客户端传答案）
 */
export async function POST(req: NextRequest) {
  try {
    const me = getUserEmail(req);
    if (!me) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const body = await req.json().catch(() => ({}));

    // 模式 (b)：错题重做
    if (typeof body.question === "string" && !body.token) {
      const q = String(body.question);
      const { rows } = await pool.query(
        "SELECT * FROM quiz_results WHERE user_email = $1 AND question = $2 ORDER BY created_at DESC LIMIT 1",
        [me, q],
      );
      const ref = rows[0];
      if (!ref) return NextResponse.json({ error: "题目不存在" }, { status: 404 });
      const studentAnswer = String(body.studentAnswer || "");
      // 兼容两种存量格式：correct_answer 为字母(A-D)或全文文本（seed 老数据）
      let isCorrect = false;
      if (/^[A-D]$/.test(ref.correct_answer || "")) {
        isCorrect = studentAnswer === ref.correct_answer;
      } else {
        const idx = /^[A-D]$/.test(studentAnswer) ? studentAnswer.charCodeAt(0) - 65 : -1;
        const chosenText = idx >= 0 && Array.isArray(ref.options) ? ref.options[idx] : studentAnswer;
        isCorrect = String(chosenText).trim() === String(ref.correct_answer).trim();
      }
      await pool.query(
        "INSERT INTO quiz_results (user_email, question, correct_answer, student_answer, is_correct, topic, options, explanation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [me, q, ref.correct_answer, studentAnswer, isCorrect, ref.topic,
          JSON.stringify(ref.options || []), ref.explanation || ""],
      );
      await recordQuizResultByTopic(me, ref.topic, isCorrect);
      return NextResponse.json({ ok: true, results: [{ index: 0, isCorrect, correctAnswer: ref.correct_answer, explanation: ref.explanation || "" }] });
    }

    // 模式 (a)：新小测 token 判分
    const token = String(body.token || "");
    cleanupSessions();
    const session = quizSessions.get(token);
    if (!session || session.email !== me) {
      return NextResponse.json({ error: "小测已过期，请重新生成" }, { status: 400 });
    }
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const results: Array<{ index: number; isCorrect: boolean; correctAnswer: string; explanation: string }> = [];
    for (let i = 0; i < session.questions.length; i++) {
      const q = session.questions[i];
      const ans = answers.find((a: any) => Number(a.index) === i);
      const studentAnswer = String(ans?.studentAnswer || "");
      const isCorrect = studentAnswer === q.correct;
      results.push({ index: i, isCorrect, correctAnswer: q.correct, explanation: q.explanation });
      await pool.query(
        "INSERT INTO quiz_results (user_email, question, correct_answer, student_answer, is_correct, topic, options, explanation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [me, q.question, q.correct, studentAnswer, isCorrect, q.topic, JSON.stringify(q.options), q.explanation],
      );
      await recordQuizResultByTopic(me, q.topic, isCorrect);
    }
    quizSessions.delete(token);
    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error('[quiz] POST:', err?.message || err);
    return NextResponse.json({ error: "小测结果保存失败，请稍后重试" }, { status: 500 });
  }
}
