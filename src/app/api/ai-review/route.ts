import { NextRequest, NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth-server";
import {
  pool,
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

    // 随机抽检：取最近 5 条无任何反馈的 AI 回答生成待审项（确定性：按 id 倒序）
    if (action === "spotcheck") {
      const limit = Math.min(10, Math.max(1, Number(body.limit) || 5));
      const { rows } = await pool.query(
        `SELECT id FROM ai_qa_messages m
         WHERE NOT EXISTS (SELECT 1 FROM ai_content_feedback f WHERE f.message_id = m.id)
         ORDER BY m.id DESC LIMIT $1`,
        [limit],
      );
      let added = 0;
      for (const row of rows) {
        await pool.query(
          `INSERT INTO ai_content_feedback (message_id, user_email, reason, note, status)
           VALUES ($1, $2, '教师抽检', '系统按最近问答自动抽取，供教师定期抽检 AI 回答质量', 'pending')`,
          [row.id, auth.email],
        );
        added += 1;
      }
      return NextResponse.json({ ok: true, added });
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
