import { NextRequest, NextResponse } from "next/server";
import {
  normalizeIdentifier,
  sendVerificationCode,
  type CodePurpose,
} from "@/lib/auth-identifiers";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "local";
}

/** 发送验证码（注册 / 找回密码共用） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const purpose = String(body.purpose || "");
    if (purpose !== "REGISTER" && purpose !== "RESET_PASSWORD") {
      return NextResponse.json({ error: "无效的验证码用途" }, { status: 400 });
    }
    const normalized = normalizeIdentifier(body.identifier);
    if (!normalized) {
      return NextResponse.json({ error: "请输入正确的手机号或邮箱" }, { status: 400 });
    }

    const result = await sendVerificationCode({
      identifier: normalized.identifier,
      type: normalized.type,
      purpose: purpose as CodePurpose,
      ip: clientIp(req),
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, retryAfter: result.retryAfter },
        { status: result.status },
      );
    }
    return NextResponse.json({
      ok: true,
      masked: result.masked,
      retryAfter: result.retryAfter,
      echoCode: result.echoCode, // 仅演示/开发模式（VERIFICATION_CODE_ECHO=true）时存在
    });
  } catch (err: any) {
    console.error('[auth/verification/send]:', err?.message || err);
    return NextResponse.json({ error: "验证码服务暂时不可用，请稍后重试" }, { status: 500 });
  }
}
