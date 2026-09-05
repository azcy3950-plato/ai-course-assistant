import { NextRequest, NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth-server";
import { ensureLearningSchema, addClassMember, removeClassMember } from "@/lib/learning-db";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  const { id } = await params;
  try {
    const { email } = await req.json().catch(() => ({}));
    if (!email || !String(email).trim()) return NextResponse.json({ error: "请填写学生邮箱" }, { status: 400 });
    await ensureLearningSchema();
    const result = await addClassMember(Number(id), auth.email, String(email).trim().toLowerCase());
    if ((result as any).error) return NextResponse.json({ error: (result as any).error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  const { id } = await params;
  try {
    const { email } = await req.json().catch(() => ({}));
    if (!email) return NextResponse.json({ error: "缺少学生邮箱" }, { status: 400 });
    await ensureLearningSchema();
    const result = await removeClassMember(Number(id), auth.email, String(email).toLowerCase());
    await logAudit({ operatorEmail: auth.email, action: "CLASS_MEMBER_REMOVE", targetType: "class", targetId: id, detail: String(email).toLowerCase() });
    if ((result as any).error) return NextResponse.json({ error: (result as any).error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
