/**
 * 验证 SMTP 邮件配置是否可用（发一封测试验证码邮件）：
 *   node --env-file=.env.local scripts/test-mailer.mjs 收件邮箱
 */
import nodemailer from "nodemailer";

async function main() {
  const to = process.argv[2];
  if (!to || !to.includes("@")) {
    throw new Error("用法：node --env-file=.env.local scripts/test-mailer.mjs 收件邮箱");
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error("缺少 SMTP 配置（SMTP_HOST/SMTP_USER/SMTP_PASS）");
  }
  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: "【基规智学】SMTP 配置测试",
    text: "邮件服务配置成功。你的测试验证码为：123456（仅用于验证 SMTP 通道）。",
  });
  console.log("✅ 测试邮件已发送：", info.messageId);
}

main().catch((e) => {
  console.error("❌ 发送失败：", e.message || e);
  process.exitCode = 1;
});
