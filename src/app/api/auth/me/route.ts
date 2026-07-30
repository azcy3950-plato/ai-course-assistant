import { NextRequest, NextResponse } from "next/server";
import { verify } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "aicourse-jwt-secret-key-2026";

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const decoded = verify(token, JWT_SECRET) as any;
    return NextResponse.json({
      user: { id: decoded.id, email: decoded.email, name: decoded.name, role: decoded.role },
    });
  } catch {
    return NextResponse.json({ error: "登录已过期" }, { status: 401 });
  }
}
