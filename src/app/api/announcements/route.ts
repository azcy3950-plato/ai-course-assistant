import { NextRequest, NextResponse } from "next/server";
import { verify as jwtVerify } from "jsonwebtoken";
import { listAnnouncements } from "@/lib/announcements";

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

// 任意登录用户(学生/教师)读取最新公告
export async function GET(req: NextRequest) {
  const user = getUser(req);
  if (!user || !user.email) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const announcements = await listAnnouncements(5);
  return NextResponse.json({ announcements });
}
