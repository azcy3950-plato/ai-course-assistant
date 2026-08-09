import { NextRequest, NextResponse } from "next/server";
import { verify } from "jsonwebtoken";
import {
  buildSuggestedPath,
  loadKnowledgeGraph,
  recordNodeInteraction,
} from "@/lib/knowledge-graph";

function getUserEmail(req: NextRequest): string {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const jwtSecret = process.env.JWT_SECRET;
  if (!token || !jwtSecret) return "";
  try {
    const payload = verify(token, jwtSecret) as { email?: string };
    return payload.email || "";
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  try {
    const userEmail = getUserEmail(req);
    if (!userEmail) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const graph = await loadKnowledgeGraph(userEmail);
    return NextResponse.json({
      graph,
      suggestedPath: buildSuggestedPath(graph),
    });
  } catch (error) {
    console.error('[knowledge-graph] GET:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "知识图谱服务暂时不可用" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userEmail = getUserEmail(req);
    if (!userEmail) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const body = await req.json();
    if (body.action !== "record_interaction" || !body.nodeId) {
      return NextResponse.json({ error: "无效操作" }, { status: 400 });
    }
    const progress = await recordNodeInteraction(
      userEmail,
      String(body.nodeId),
      body.kind === "question" ? "question" : "study",
    );
    return NextResponse.json({ ok: true, progress });
  } catch (error) {
    console.error('[knowledge-graph] POST:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "学习状态更新失败，请稍后重试" }, { status: 500 });
  }
}
