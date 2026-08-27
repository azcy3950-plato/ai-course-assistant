import { NextRequest, NextResponse } from "next/server";
import { requireTeacher, unauthorized } from "@/lib/auth-server";
import { ensureLearningSchema, listClasses, createClass } from "@/lib/learning-db";

export async function GET(req: NextRequest) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    const classes = await listClasses(auth.email);
    return NextResponse.json(classes);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { auth, resp } = requireTeacher(req);
  if (resp) return resp;
  try {
    const { name } = await req.json().catch(() => ({}));
    if (!name || !String(name).trim()) return NextResponse.json({ error: "班级名称不能为空" }, { status: 400 });
    await ensureLearningSchema();
    const cls = await createClass(auth.email, String(name).trim());
    return NextResponse.json(cls);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
