import { NextRequest, NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth-server";
import { ensureLearningSchema, listClassStudents, deleteClass } from "@/lib/learning-db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  const { id } = await params;
  try {
    await ensureLearningSchema();
    const data = await listClassStudents(Number(id), auth.email);
    if (!data) return NextResponse.json({ error: "班级不存在或无权访问" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  const { id } = await params;
  try {
    await ensureLearningSchema();
    const ok = await deleteClass(Number(id), auth.email);
    if (!ok) return NextResponse.json({ error: "班级不存在或无权删除" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
