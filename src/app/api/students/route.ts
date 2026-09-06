import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { requireTeacher } from "@/lib/auth-server";
import { ensureKnowledgeGraphSchema } from "@/lib/knowledge-graph";
import { buildAllNetworks } from "@/lib/knowledge-map-builder";
import {
  ensureLearningSchema,
  listStudentTasks,
  listLearningEvents,
  listFeedbackForStudent,
  canTeacherViewStudent,
  listTeacherStudentEmails,
} from "@/lib/learning-db";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 教师查看学生列表与学习聚合；归属校验：教师仅限本班学生（admin 全局放行，账号管理职责）。
// 单学生详情额外包含任务、学习事件、提交批阅与薄弱知识点（教学平台外围功能）
export async function GET(req: NextRequest) {
  const { auth, resp } = await requireTeacher(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    const emailParam = req.nextUrl.searchParams.get("email")?.trim().toLowerCase() || "";
    if (emailParam) {
      // 归属校验：admin 放行；教师只能看本班学生
      if (auth.role !== "admin") {
        const allowed = await canTeacherViewStudent(auth.email, emailParam);
        if (!allowed) return NextResponse.json({ error: "该学生不在您的班级中" }, { status: 403 });
      }
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
    // 教师仅能列出本班学生；admin 全局
    let rows;
    if (auth.role === "admin") {
      ({ rows } = await pool.query(
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
      ));
    } else {
      const myStudents = await listTeacherStudentEmails(auth.email);
      if (myStudents.length === 0) {
        rows = [];
      } else {
        ({ rows } = await pool.query(
          `SELECT
             u.id, u.email, u.name, u.role, u.created_at,
             (SELECT count(*) FROM learning_records lr WHERE lr.user_email = u.email) AS query_count,
             (SELECT count(*) FROM quiz_results qr WHERE qr.user_email = u.email) AS quiz_total,
             (SELECT count(*) FROM quiz_results qr WHERE qr.user_email = u.email AND qr.is_correct) AS quiz_correct,
             (SELECT count(*) FROM learning_records lr WHERE lr.user_email = u.email AND lr.has_references) AS guided_count,
             (SELECT max(created_at) FROM learning_records lr WHERE lr.user_email = u.email) AS last_active
           FROM users u
           WHERE u.role = 'student' AND u.email = ANY($1)
           ORDER BY last_active DESC NULLS LAST, u.created_at DESC`,
          [myStudents],
        ));
      }
    }
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
