import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  ensureLearningSchema,
  listDirectMessageThreads,
  getDirectMessages,
  addDirectMessage,
  addNotification,
  listStudentTeachers,
  getUserName,
} from "@/lib/learning-db";
import { authorizeDmPair } from "@/lib/dm-auth";

// ─── 收件箱 ───
export async function GET(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    if (auth.role !== "student" && auth.role !== "teacher")
      return NextResponse.json({ error: "无权限访问" }, { status: 403 });

    const withEmail = req.nextUrl.searchParams.get("with");
    if (withEmail) {
      const { resp: authResp, pair } = await authorizeDmPair(req, withEmail);
      if (authResp || !pair) return authResp;
      const [messages, peerName] = await Promise.all([
        getDirectMessages(pair.studentEmail, pair.teacherEmail),
        getUserName(pair.studentEmail === auth.email ? pair.teacherEmail : pair.studentEmail),
      ]);
      return NextResponse.json({
        me: auth.email,
        messages,
        peer: { email: pair.studentEmail === auth.email ? pair.teacherEmail : pair.studentEmail, name: peerName },
      });
    }

    const { conversations, totalUnread } = await listDirectMessageThreads(auth.email);
    const payload: Record<string, unknown> = { me: auth.email, conversations, totalUnread };
    if (auth.role === "student") payload.availablePeers = await listStudentTeachers(auth.email);
    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── 发私信 ───
export async function POST(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    const body = await req.json().catch(() => ({}));
    await ensureLearningSchema();
    const { resp: authResp, pair } = await authorizeDmPair(req, String(body.with || ""));
    if (authResp || !pair) return authResp;

    const text = String(body.body || "").trim();
    if (!text || text.length > 2000)
      return NextResponse.json({ error: "消息内容需为 1~2000 字" }, { status: 400 });

    const message = await addDirectMessage({ ...pair, senderEmail: auth.email, body: text });

    // 通知对端（火后即忘；消息行本身不丢）。私信不加 logAudit：direct_messages 行即完整记录，且不属管理特权操作。
    addNotification({
      userEmail: auth.role === "student" ? pair.teacherEmail : pair.studentEmail,
      type: "DIRECT_MSG",
      title: auth.role === "student" ? "学生发来私信" : "教师回复了您的私信",
      body: text.slice(0, 120),
      link: "/messages/" + encodeURIComponent(auth.email),
      dedupeKey: "DM:" + message.id,
    }).catch(() => {});

    return NextResponse.json({ ok: true, message });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
