import nodemailer from "nodemailer";

/**
 * 邮件验证码发送（SMTP）。
 * 配置全部走环境变量，不写死任何密钥：
 *   EMAIL_PROVIDER=smtp
 *   SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM
 */

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
      : undefined,
  });
  return transporter;
}

export async function sendEmailCode(to: string, code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: "【基规智学】验证码",
      text: `你的验证码为：${code}\n\n验证码5分钟内有效。\n请勿向他人泄露验证码。`,
    });
    return { ok: true };
  } catch (err: any) {
    console.error("[mailer]", err?.message || err);
    return { ok: false, error: err?.message || "发送失败" };
  }
}
