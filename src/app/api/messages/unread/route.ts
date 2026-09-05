import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { ensureLearningSchema, unreadDirectMessageCount } from "@/lib/learning-db";

/** Navbar 信封角标专用轻端点（与收件箱 GET 分离，避免每 60s 跑会话聚合） */
export async function GET(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    if (auth.role !== "student" && auth.role !== "teacher")
      return NextResponse.json({ error: "无权限访问" }, { status: 403 });
    const count = await unreadDirectMessageCount(auth.email);
    return NextResponse.json({ count });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
