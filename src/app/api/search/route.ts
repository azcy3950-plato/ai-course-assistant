import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { buildAllNetworks } from "@/lib/knowledge-map-builder";
import { pool, ensureLearningSchema } from "@/lib/learning-db";

/**
 * 全局搜索（数据库查询，无 Elasticsearch）。
 * 学生：知识点（课程图谱）/ 自己的任务 / 自己的 AI 问答。
 * 教师：学生（姓名或邮箱前缀，限自己班级）/ 任务 / 知识点。
 */
export async function GET(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ nodes: [], tasks: [], students: [], qa: [] });

  try {
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;

    // 知识点：内存课程图谱匹配
    const nodes: Array<{ id: string; name: string; chapter: string }> = [];
    for (const net of buildAllNetworks()) {
      for (const n of net.nodes) {
        if (n.name.includes(q) || n.chapter.includes(q)) {
          nodes.push({ id: n.id, name: n.name, chapter: n.chapter });
        }
        if (nodes.length >= 20) break;
      }
      if (nodes.length >= 20) break;
    }

    let tasks: any[] = [];
    let students: any[] = [];
    let qa: any[] = [];

    await ensureLearningSchema();
    if (auth.role === "teacher") {
      [tasks, students] = await Promise.all([
        pool.query(
          `SELECT id, title, type, deadline FROM tasks
           WHERE teacher_email = $1 AND (title ILIKE $2 OR description ILIKE $2) ORDER BY created_at DESC LIMIT 10`,
          [auth.email, like],
        ).then((r) => r.rows),
        pool.query(
          `SELECT DISTINCT u.email, u.name FROM users u
           JOIN class_members m ON m.user_email = u.email
           JOIN classes c ON c.id = m.class_id
           WHERE c.teacher_email = $1 AND (u.name ILIKE $2 OR u.email ILIKE $2) LIMIT 10`,
          [auth.email, like],
        ).then((r) => r.rows.map((s) => ({ email: s.email, name: s.name }))),
      ]);
    } else {
      [tasks, qa] = await Promise.all([
        pool.query(
          `SELECT t.id, t.title, t.type, t.deadline, st.status FROM student_tasks st
           JOIN tasks t ON t.id = st.task_id
           WHERE st.user_email = $1 AND t.title ILIKE $2 ORDER BY st.updated_at DESC LIMIT 10`,
          [auth.email, like],
        ).then((r) => r.rows),
        pool.query(
          `SELECT id, question, created_at FROM ai_qa_messages
           WHERE user_email = $1 AND question ILIKE $2 ORDER BY created_at DESC LIMIT 10`,
          [auth.email, like],
        ).then((r) => r.rows),
      ]);
    }

    return NextResponse.json({ nodes, tasks, students, qa });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
