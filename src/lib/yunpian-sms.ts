/**
 * 云片（Yunpian）短信验证码发送。
 * 配置全部走环境变量：
 *   SMS_PROVIDER=yunpian
 *   YUNPIAN_API_KEY（云片控制台 → APIKEY 管理 → 复制 v2 APIKey）
 *   YUNPIAN_TEXT_TEMPLATE（可选，需与云片后台审核通过的模板内容一致，{code} 为变量占位）
 */
export async function sendSmsCode(phone: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.YUNPIAN_API_KEY;
  if (!apiKey) return { ok: false, error: "YUNPIAN_API_KEY 未配置" };
  const tpl = process.env.YUNPIAN_TEXT_TEMPLATE || "您的验证码为{code}，5分钟内有效，请勿泄露给他人。";
  const text = tpl.replace("{code}", code);
  try {
    const form = new URLSearchParams({ apikey: apiKey, mobile: phone, text });
    const res = await fetch("https://sms.yunpian.com/v2/sms/single_send.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: form.toString(),
    });
    const data: any = await res.json();
    if (data?.code !== 0) {
      console.error("[yunpian-sms]", data?.code, data?.msg);
      return { ok: false, error: data?.msg || "发送失败" };
    }
    return { ok: true };
  } catch (err: any) {
    console.error("[yunpian-sms]", err?.message || err);
    return { ok: false, error: err?.message || "发送失败" };
  }
}
