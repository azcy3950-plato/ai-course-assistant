import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  ensureLearningSchema,
  addFavorite,
  removeFavorite,
  setFavoriteReview,
  listFavorites,
} from "@/lib/learning-db";

/** 收藏与待复习（仅操作自己的数据） */
export async function GET(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    await ensureLearningSchema();
    const items = await listFavorites(auth.email);
    return NextResponse.json({ items });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    const { refType, refId, note, inReview } = await req.json().catch(() => ({}));
    if (!["node", "qa_message", "quiz_result"].includes(refType) || !refId) {
      return NextResponse.json({ error: "参数无效" }, { status: 400 });
    }
    await ensureLearningSchema();
    await addFavorite({ email: auth.email, refType, refId: String(refId), note: String(note || "") });
    if (inReview) {
      const items = await listFavorites(auth.email);
      const fav = items.find((f) => f.ref_type === refType && f.ref_id === String(refId));
      if (fav) await setFavoriteReview(fav.id, auth.email, true);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    const { id, inReview } = await req.json().catch(() => ({}));
    if (!id) return NextResponse.json({ error: "缺少收藏 ID" }, { status: 400 });
    await ensureLearningSchema();
    await setFavoriteReview(Number(id), auth.email, Boolean(inReview));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { auth, resp } = requireUser(req);
  if (resp) return resp;
  try {
    const { id } = await req.json().catch(() => ({}));
    if (!id) return NextResponse.json({ error: "缺少收藏 ID" }, { status: 400 });
    await ensureLearningSchema();
    await removeFavorite(Number(id), auth.email);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
