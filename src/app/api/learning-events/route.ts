import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  ensureLearningSchema,
  addLearningEvent,
  listLearningEvents,
  markQuizCorrected,
} from "@/lib/learning-db";

/** 允许客户端记录的事件类型（只记录有教学意义的事件） */
const ALLOWED_TYPES = new Set([
  "KNOWLEDGE_COMPLETED",
  "PRACTICE_COMPLETED",
  "PRACTICE_CORRECTED",
  "GUIDED_COMPLETED",
  "SIMULATION_SUBMITTED",
  "TASK_COMPLETED",
  "TASK_STARTED",
  "TEACHER_FEEDBACK_RECEIVED",
]);

export async function GET(req: NextRequest) {
  const { auth, resp } = requireUser(req);
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
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    const body = await req.json().catch(() => ({}));
    const type = String(body.type || "");
    if (!ALLOWED_TYPES.has(type)) return NextResponse.json({ error: "不允许的事件类型" }, { status: 400 });
    await ensureLearningSchema();

    // 错题订正：同时记录到 practice_corrections
    if (type === "PRACTICE_CORRECTED" && body.refType === "quiz_result" && body.refId) {
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
