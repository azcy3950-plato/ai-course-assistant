import { NextRequest, NextResponse } from "next/server";
import { verifyUser, unauthorized, forbidden } from "@/lib/auth-server";
import { canTeacherViewStudent, listStudentTeachers } from "@/lib/learning-db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface DmAuthResult {
  auth: { ok: boolean; email: string; role: string | null };
  resp: NextResponse | null;
  /** 归一化会话键（学生在前、教师在后）；resp 非 null 时为 null */
  pair: { studentEmail: string; teacherEmail: string } | null;
}

/**
 * 私信会话授权（GET ?with= / POST / PUT 共用）：
 * - 未登录 401；admin 403；with 缺失/非法邮箱/等于自己 400
 * - 教师 ↔ 本班学生（canTeacherViewStudent）；学生 ↔ 自己的任课教师（listStudentTeachers）
 * 注：平台账号均邮箱注册（手机号注册用户 JWT email 回退为手机号，暂不在私信范围内）。
 */
export async function authorizeDmPair(req: NextRequest, withEmail: string): Promise<DmAuthResult> {
  const auth = verifyUser(req);
  if (!auth.ok) return { auth, resp: unauthorized(), pair: null };
  if (auth.role !== "student" && auth.role !== "teacher")
    return { auth, resp: forbidden(), pair: null };
  const peer = (withEmail || "").trim().toLowerCase();
  if (!EMAIL_RE.test(peer))
    return { auth, resp: NextResponse.json({ error: "缺少参数" }, { status: 400 }), pair: null };
  if (peer === auth.email.toLowerCase())
    return { auth, resp: NextResponse.json({ error: "不能给自己发送私信" }, { status: 400 }), pair: null };

  if (auth.role === "teacher") {
    const ok = await canTeacherViewStudent(auth.email, peer);
    if (!ok)
      return { auth, resp: NextResponse.json({ error: "该学生不在您的班级中" }, { status: 403 }), pair: null };
    return { auth, resp: null, pair: { studentEmail: peer, teacherEmail: auth.email } };
  }
  const teachers = await listStudentTeachers(auth.email);
  if (!teachers.some((t) => t.teacher_email === peer))
    return { auth, resp: NextResponse.json({ error: "只能向自己的任课教师发起私信" }, { status: 403 }), pair: null };
  return { auth, resp: null, pair: { studentEmail: auth.email, teacherEmail: peer } };
}
