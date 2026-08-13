import { NextRequest, NextResponse } from "next/server";
import { verify as jwtVerify } from "jsonwebtoken";
import { createAnnouncement, deleteAnnouncement, listAnnouncements } from "@/lib/announcements";

function getUser(req: NextRequest): { email: string; role: string } | null {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const jwtSecret = process.env.JWT_SECRET;
  if (!token || !jwtSecret) return null;
  try {
    const payload = jwtVerify(token, jwtSecret, { algorithms: ["HS256"] }) as unknown as { email?: string; role?: string };
    return { email: payload.email || "", role: payload.role || "student" };
  } catch {
    return null;
  }
}

// 教师:公告列表(全部,最多 50 条)
export async function GET(req: NextRequest) {
  const user = getUser(req);
  if (!user?.email) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "teacher") return NextResponse.json({ error: "仅教师可管理公告" }, { status: 403 });
  const announcements = await listAnnouncements(50);
  return NextResponse.json({ announcements });
}

// 教师:发布公告 { title, content }
export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user?.email) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "teacher") return NextResponse.json({ error: "仅教师可发布公告" }, { status: 403 });
  let body: { title?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  const title = String(body.title || "").trim();
  if (!title) return NextResponse.json({ error: "公告标题不能为空" }, { status: 400 });
  const announcement = await createAnnouncement(title, body.content || "", user.email);
  return NextResponse.json({ ok: true, announcement }, { status: 201 });
}

// 教师:删除公告 { id }
export async function DELETE(req: NextRequest) {
  const user = getUser(req);
  if (!user?.email) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "teacher") return NextResponse.json({ error: "仅教师可删除公告" }, { status: 403 });
  let body: { id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  const ok = await deleteAnnouncement(Number(body.id) || 0);
  if (!ok) return NextResponse.json({ error: "公告不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
