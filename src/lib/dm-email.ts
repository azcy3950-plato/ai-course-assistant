import { pool, getUserName } from "./learning-db";
import { getTransporter } from "./mailer";

export type DmEmailStatus = "sent" | "failed" | "no_email" | "not_applicable";

/** Send only to the email stored on an active student account, never to an unchecked request address. */
export async function sendDirectMessageEmail(input: {
  studentIdentifier: string;
  teacherEmail: string;
  body: string;
  messageId: string | number;
}): Promise<DmEmailStatus> {
  try {
    const { rows } = await pool.query(
      "SELECT email FROM users WHERE (email = $1 OR phone = $1) AND role = 'student' AND COALESCE(status, '') <> 'disabled' LIMIT 1",
      [input.studentIdentifier],
    );
    const email = rows[0]?.email;
    if (typeof email !== "string" || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email)) return "no_email";
    if (!process.env.SMTP_HOST || !(process.env.SMTP_FROM || process.env.SMTP_USER)) return "failed";
    const teacherName = await getUserName(input.teacherEmail).catch(() => null);
    const sender = teacherName || "你的教师";
    let link = "";
    if (process.env.APP_URL) {
      const base = new URL(process.env.APP_URL);
      if (["https:", "http:"].includes(base.protocol)) {
        link = new URL("/messages/" + encodeURIComponent(input.teacherEmail), base.origin).href;
      }
    }
    const result = await getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: { name: "", address: email },
      subject: "【基规智学】你收到一条教师私信",
      text: `${sender}在基规智学给你发送了私信：\n\n${input.body}\n\n${link ? `查看并回复私信：${link}` : "请登录基规智学，进入“私信”查看并回复。"}\n\n这是一封系统通知邮件，请在网站内回复，不要直接回复此邮件。`,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    if (!result.accepted?.length) return "failed";
    return "sent";
  } catch {
    // Do not log private message content, student addresses, or SMTP credentials.
    console.error("[dm-email] delivery failed for message", input.messageId);
    return "failed";
  }
}
