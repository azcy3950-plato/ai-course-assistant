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
    const graph = await loadKnowledgeGraph(userEmail);
    return NextResponse.json({
      graph,
      suggestedPath: buildSuggestedPath(graph),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "知识图谱加载失败";
    return NextResponse.json({ error: message }, { status: 500 });
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
    const message = error instanceof Error ? error.message : "学习状态更新失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
