import { NextRequest, NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth-server";
import {
  ensureLearningSchema,
  listAiFeedback,
  listAiVersions,
  updateAiFeedbackStatus,
  addAiVersion,
} from "@/lib/learning-db";

/** 教师 AI 内容审核：待处理队列 + 版本修正（保留 V1 原回答，写入 V(n+1) 修正版） */
export async function GET(req: NextRequest) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    const items = await listAiFeedback();
    const pending = items.filter((i: any) => i.status === "pending").length;
    const resolved = items.filter((i: any) => i.status === "resolved").length;
    return NextResponse.json({ items, stats: { total: items.length, pending, resolved } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    await ensureLearningSchema();

    if (action === "resolve" || action === "dismiss") {
      const feedbackId = Number(body.feedbackId);
      if (!feedbackId) return NextResponse.json({ error: "缺少反馈 ID" }, { status: 400 });
      await updateAiFeedbackStatus(feedbackId, action === "resolve" ? "resolved" : "dismissed");
      return NextResponse.json({ ok: true });
    }

    if (action === "edit") {
      const messageId = Number(body.messageId);
      const content = String(body.content || "").trim();
      if (!messageId || !content) return NextResponse.json({ error: "缺少消息 ID 或修正内容" }, { status: 400 });
      const version = await addAiVersion({
        messageId,
        content,
        editedBy: auth.email,
        editReason: String(body.editReason || "教师修正"),
      });
      if (!version) return NextResponse.json({ error: "问答记录不存在" }, { status: 404 });
      // 修正后，该条消息的待处理反馈全部标记为已处理
      const items = await listAiFeedback();
      for (const item of items as any[]) {
        if (item.message_id === messageId && item.status === "pending") {
          await updateAiFeedbackStatus(item.id, "resolved");
        }
      }
      return NextResponse.json({ ok: true, version });
    }

    return NextResponse.json({ error: "无效操作" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
