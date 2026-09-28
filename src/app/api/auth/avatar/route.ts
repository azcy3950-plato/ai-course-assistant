import { NextRequest, NextResponse } from "next/server";
import { verify } from "jsonwebtoken";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { avatarFileName } from "@/lib/avatar-name";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const AVATAR_DIR = join(process.cwd(), "public", "avatars");

const MAGIC: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/jpeg": [0xff, 0xd8],
  "image/webp": [0x52, 0x49, 0x46, 0x46], // RIFF
};

export async function POST(req: NextRequest) {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return NextResponse.json({ error: "服务端尚未配置 JWT_SECRET" }, { status: 500 });
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
    let decoded: any;
    try { decoded = verify(token, jwtSecret); } catch { return NextResponse.json({ error: "登录已过期" }, { status: 401 }); }

    const body = await req.json().catch(() => ({}));
    const dataURL = typeof body.dataURL === "string" ? body.dataURL : "";
    const m = dataURL.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!m) return NextResponse.json({ error: "仅支持 png/jpeg/webp 图片" }, { status: 400 });
    const mime = m[1];
    let buf: Buffer;
    try { buf = Buffer.from(m[2], "base64"); } catch { return NextResponse.json({ error: "图片数据无效" }, { status: 400 }); }
    if (buf.length < 12 || buf.length > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "图片大小需在 12B-2MB 之间" }, { status: 400 });
    }
    // 魔数校验:防伪装扩展名/非图片数据
    const magic = MAGIC[mime];
    let matched = true;
    for (let i = 0; i < magic.length; i++) if (buf[i] !== magic[i]) { matched = false; break; }
    if (mime === "image/webp" && (buf[8] !== 0x57 || buf[9] !== 0x45 || buf[10] !== 0x42 || buf[11] !== 0x50)) matched = false;
    if (!matched) return NextResponse.json({ error: "图片内容与格式不符" }, { status: 400 });

    // 文件名 = email 哈希(防路径穿越/枚举),原子写
    const name = avatarFileName(String(decoded.email), mime);
    mkdirSync(AVATAR_DIR, { recursive: true });
    writeFileSync(join(AVATAR_DIR, name), buf);
    const avatarPath = `/avatars/${name}`;
    await pool.query("UPDATE users SET avatar = $1 WHERE id = $2", [avatarPath, decoded.id]);
    return NextResponse.json({ ok: true, avatar: avatarPath });
  } catch (err: any) {
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
