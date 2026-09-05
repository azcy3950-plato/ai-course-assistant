import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  ensureLearningSchema,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  unreadNotificationCount,
  lazyDueSoonNotifications,
} from "@/lib/learning-db";

export async function GET(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    // 惰性检查截止提醒（学生在查询时补发即将截止且未提醒过的任务）
    if (auth.role === "student") {
      await lazyDueSoonNotifications(auth.email).catch(() => {});
    }
    const [items, unread] = await Promise.all([
      listNotifications(auth.email),
      unreadNotificationCount(auth.email),
    ]);
    return NextResponse.json({ items, unread });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    const body = await req.json().catch(() => ({}));
    await ensureLearningSchema();
    if (body.all === true) {
      await markAllNotificationsRead(auth.email);
    } else if (body.id) {
      await markNotificationRead(Number(body.id), auth.email);
    } else {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
