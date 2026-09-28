import { NextRequest, NextResponse } from "next/server";
import {
  normalizeIdentifier,
  consumeVerificationCode,
  hashCode,
  signResetToken,
  type CodePurpose,
} from "@/lib/auth-identifiers";

/**
 * 验证验证码（找回密码流程第 2 步）。
 * 注册场景的验证码在 /api/auth/register 内联校验，无需调用本接口。
 * 验证成功后签发 10 分钟短期 resetToken 用于设置新密码。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const purpose = String(body.purpose || "");
    if (purpose !== "RESET_PASSWORD" && purpose !== "REGISTER") {
      return NextResponse.json({ error: "无效的验证码用途" }, { status: 400 });
    }
    const normalized = normalizeIdentifier(body.identifier);
    if (!normalized || normalized.type !== "EMAIL") {
      return NextResponse.json({ error: "请输入正确的邮箱地址" }, { status: 400 });
    }
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "验证码错误或已失效" }, { status: 400 });
    }

    const verified = await consumeVerificationCode(
      normalized.identifier,
      normalized.type,
      purpose as CodePurpose,
      code,
    );
    if (!verified) {
      return NextResponse.json({ error: "验证码错误或已失效" }, { status: 400 });
    }

    const result: { ok: boolean; resetToken?: string } = { ok: true };
    if (purpose === "RESET_PASSWORD") {
      result.resetToken = signResetToken({
        identifier: normalized.identifier,
        type: normalized.type,
        purpose: "RESET_PASSWORD",
        codeHash: hashCode(normalized.identifier, code),
      });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[auth/verification/verify]:', err?.message || err);
    return NextResponse.json({ error: "验证码服务暂时不可用，请稍后重试" }, { status: 500 });
  }
}
