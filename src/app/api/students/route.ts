import { NextRequest, NextResponse } from "next/server";
import { verify } from "jsonwebtoken";
import { Pool } from "pg";
import { ensureKnowledgeGraphSchema } from "@/lib/knowledge-graph";
import { buildAllNetworks } from "@/lib/knowledge-map-builder";
import {
  ensureLearningSchema,
  listStudentTasks,
  listLearningEvents,
  listFeedbackForStudent,
} from "@/lib/learning-db";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function getTeacher(req: NextRequest): { email: string; role: string } | null {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const jwtSecret = process.env.JWT_SECRET;
  if (!token || !jwtSecret) return null;
  try {
    const payload = verify(token, jwtSecret) as { email?: string; role?: string };
    return payload.email && payload.role === "teacher" ? { email: payload.email, role: "teacher" } : null;
  } catch { return null; }
}

// 教师查看真实学生列表(users 表)与学习聚合(learning_records / quiz_results)；
// 单学生详情额外包含任务、学习事件、提交批阅与薄弱知识点（教学平台外围功能）
export async function GET(req: NextRequest) {
  try {
    if (!getTeacher(req)) return NextResponse.json({ error: "仅教师可访问" }, { status: 403 });
    const emailParam = req.nextUrl.searchParams.get("email")?.trim().toLowerCase() || "";
    if (emailParam) {
      // 单学生详情:统计 + 问答记录 + 测验结果 + 任务/事件/提交/薄弱知识点
      await Promise.all([ensureLearningSchema(), ensureKnowledgeGraphSchema().catch(() => {})]);
      const { rows: userRows } = await pool.query(
        "SELECT id, email, name, role FROM users WHERE email = $1 AND role = 'student'",
        [emailParam],
      );
      if (!userRows.length) return NextResponse.json({ error: "未找到该学生" }, { status: 404 });
      const user = userRows[0];
      const [records, quizzes, tasks, events, feedback, progressRes, subRes] = await Promise.all([
        pool.query("SELECT * FROM learning_records WHERE user_email = $1 ORDER BY created_at DESC LIMIT 200", [emailParam]),
        pool.query("SELECT * FROM quiz_results WHERE user_email = $1 ORDER BY created_at DESC LIMIT 200", [emailParam]),
        listStudentTasks(emailParam),
        listLearningEvents(emailParam, 50),
        listFeedbackForStudent(emailParam),
        pool.query(
          `SELECT p.node_id, p.mastery, p.quiz_correct, p.quiz_total
           FROM student_node_progress p
           WHERE p.user_email = $1 ORDER BY p.mastery ASC NULLS LAST LIMIT 10`,
          [emailParam],
        ),
        pool.query(
          `SELECT s.*, t.title AS task_title, t.type AS task_type
           FROM task_submissions s JOIN tasks t ON t.id = s.task_id
           WHERE s.user_email = $1 ORDER BY s.submitted_at DESC LIMIT 30`,
          [emailParam],
        ),
      ]);
      const quizRows = quizzes.rows as Array<Record<string, unknown>>;
      const correct = quizRows.filter((q) => q.is_correct).length;
      const topics = new Set<string>();
      records.rows.forEach((r: any) => (Array.isArray(r.topics) ? r.topics : []).forEach((t: string) => topics.add(String(t))));
      const stats = {
        name: user.name,
        email: user.email,
        totalQuestions: Number(records.rowCount || 0),
        totalQuizzes: quizRows.length,
        correct,
        rate: quizRows.length ? Math.round((correct / quizRows.length) * 100) : 0,
        topics: [...topics].slice(0, 30),
      };
      // 薄弱知识点名称用课程图谱解析（progress 节点 id 与图谱同源，不再 JOIN legacy 表）
      const nodeNameMap = new Map<string, string>();
      for (const net of buildAllNetworks()) {
        for (const n of net.nodes) nodeNameMap.set(n.id, n.name);
      }
      const weakNodes = progressRes.rows.map((r: any) => ({
        ...r,
        node_name: nodeNameMap.get(r.node_id) || r.node_id,
      }));
      return NextResponse.json({
        stats,
        records: records.rows,
        quizzes: quizRows,
        user: { email: user.email, name: user.name },
        tasks,
        events,
        feedback,
        submissions: subRes.rows,
        quizStats: {
          total: quizRows.length,
          correct,
          rate: quizRows.length ? Math.round((correct / quizRows.length) * 100) : null,
        },
        weakNodes,
      });
    }
    const { rows } = await pool.query(
      `SELECT
         u.id, u.email, u.name, u.role, u.created_at,
         (SELECT count(*) FROM learning_records lr WHERE lr.user_email = u.email) AS query_count,
         (SELECT count(*) FROM quiz_results qr WHERE qr.user_email = u.email) AS quiz_total,
         (SELECT count(*) FROM quiz_results qr WHERE qr.user_email = u.email AND qr.is_correct) AS quiz_correct,
         (SELECT count(*) FROM learning_records lr WHERE lr.user_email = u.email AND lr.has_references) AS guided_count,
         (SELECT max(created_at) FROM learning_records lr WHERE lr.user_email = u.email) AS last_active
       FROM users u
       WHERE u.role = 'student'
       ORDER BY last_active DESC NULLS LAST, u.created_at DESC`,
    );
    const students = rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      queryCount: Number(r.query_count || 0),
      quizTotal: Number(r.quiz_total || 0),
      quizCorrect: Number(r.quiz_correct || 0),
      quizRate: Number(r.quiz_total || 0) ? Math.round((Number(r.quiz_correct) / Number(r.quiz_total)) * 100) : 0,
      guidedCount: Number(r.guided_count || 0),
      lastActive: r.last_active ? new Date(r.last_active).toISOString() : null,
    }));
    return NextResponse.json({ students });
  } catch (err: any) {
    console.error('[students] GET:', err?.message || err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
