import { NextRequest, NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth-server";
import { ensureKnowledgeGraphSchema } from "@/lib/knowledge-graph";
import {
  ensureLearningSchema,
  nodeAnalysis,
  nodeStudentDetail,
  listTeacherTasks,
  teacherStudentsOverview,
} from "@/lib/learning-db";

/** 学情分析（真实数据库聚合，不做大屏）：按知识点 / 按学生 / 按任务三个视角 */
export async function GET(req: NextRequest) {
  const { auth, resp } = await requireTeacher(req);
  if (resp) return resp;
  try {
    const includeDemo = req.nextUrl.searchParams.get("scope") === "all";
    await Promise.all([ensureLearningSchema(), ensureKnowledgeGraphSchema().catch(() => {})]);
    const nodeId = req.nextUrl.searchParams.get("nodeId");
    const [nodes, tasks, students] = await Promise.all([
      nodeAnalysis(auth.email, includeDemo),
      listTeacherTasks(auth.email, includeDemo),
      teacherStudentsOverview(auth.email, includeDemo),
    ]);
    const result: any = { nodes, tasks, students };
    if (nodeId) {
      result.nodeDetail = await nodeStudentDetail(nodeId, auth.email, includeDemo);
    }
    result.scope = includeDemo ? "all" : "real";
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
