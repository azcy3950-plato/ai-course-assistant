import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  pool,
  ensureLearningSchema,
  addLearningEvent,
  listLearningEvents,
  markQuizCorrected,
} from "@/lib/learning-db";

/**
 * 允许客户端记录的事件类型。
 * 任务/提交/批阅等事实性事件（TASK_COMPLETED、SIMULATION_SUBMITTED 等）只能由
 * 服务端在真实状态流转处写入，客户端不再放行——否则学生可伪造事件污染教师仪表盘
 * 活跃度/时间线统计。
 */
const CLIENT_ALLOWED_TYPES = new Set(["GUIDED_COMPLETED", "PRACTICE_CORRECTED"]);

export async function GET(req: NextRequest) {
  const { auth, resp } = await requireUser(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    const events = await listLearningEvents(auth.email);
    return NextResponse.json(events);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { auth, resp } = await requireUser(req);
  if (resp) return resp;
  try {
    const body = await req.json().catch(() => ({}));
    const type = String(body.type || "");
    if (!CLIENT_ALLOWED_TYPES.has(type)) return NextResponse.json({ error: "不允许的事件类型" }, { status: 400 });
    await ensureLearningSchema();

    // 错题订正：校验 refId 是本用户真实的 quiz_result 记录，防止伪造
    if (type === "PRACTICE_CORRECTED") {
      if (body.refType !== "quiz_result" || !body.refId) {
        return NextResponse.json({ error: "缺少错题记录标识" }, { status: 400 });
      }
      const { rows } = await pool.query(
        "SELECT id FROM quiz_results WHERE id = $1 AND user_email = $2",
        [Number(body.refId), auth.email],
      );
      if (!rows.length) return NextResponse.json({ error: "错题记录不存在" }, { status: 400 });
      await markQuizCorrected(auth.email, Number(body.refId));
    }

    await addLearningEvent({
      userEmail: auth.email,
      type,
      title: String(body.title || "").slice(0, 200),
      summary: String(body.summary || "").slice(0, 500),
      refType: body.refType ? String(body.refType) : undefined,
      refId: body.refId ? String(body.refId) : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
