import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { requireUser } from "@/lib/auth-server";
import { ensureLearningSchema, canTeacherViewStudent, listTeacherStudentEmails } from "@/lib/learning-db";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET(req: NextRequest) {
  const { auth, resp } = await requireUser(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    const sp = new URL(req.url).searchParams;
    const requested = sp.get("email") || "";
    let rows;
    if (auth.role === "teacher" || auth.role === "admin") {
      if (requested) {
        // 指定学生：admin 全局放行；教师仅限本班学生
        if (auth.role !== "admin") {
          const allowed = await canTeacherViewStudent(auth.email, requested.trim().toLowerCase());
          if (!allowed) return NextResponse.json({ error: "该学生不在您的班级中" }, { status: 403 });
        }
        const { rows: r } = await pool.query(
          "SELECT * FROM quiz_results WHERE user_email = $1 ORDER BY created_at DESC LIMIT 200",
          [requested.trim().toLowerCase()],
        );
        rows = r;
      } else if (auth.role === "admin") {
        const { rows: r } = await pool.query("SELECT * FROM quiz_results ORDER BY created_at DESC LIMIT 200");
        rows = r;
      } else {
        // 教师不传 email：仅本班学生范围（此前查全校，跨班数据泄漏）
        const myStudents = await listTeacherStudentEmails(auth.email);
        if (myStudents.length === 0) {
          rows = [];
        } else {
          const { rows: r } = await pool.query(
            "SELECT * FROM quiz_results WHERE user_email = ANY($1) ORDER BY created_at DESC LIMIT 200",
            [myStudents],
          );
          rows = r;
        }
      }
    } else {
      // 学生只能查自己的
      const { rows: r } = await pool.query(
        "SELECT * FROM quiz_results WHERE user_email = $1 ORDER BY created_at DESC LIMIT 200",
        [auth.email],
      );
      rows = r;
    }
    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('[quiz-results] GET:', err?.message || err);
    return NextResponse.json({ error: "小测结果服务暂时不可用" }, { status: 500 });
  }
}
