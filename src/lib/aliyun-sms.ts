import Dysmsapi20170525, * as $Dysmsapi20170525 from "@alicloud/dysmsapi20170525";
import * as $OpenApi from "@alicloud/openapi-client";

/**
 * 阿里云短信验证码发送。
 * 配置全部走环境变量：
 *   SMS_PROVIDER=aliyun
 *   ALIYUN_SMS_ACCESS_KEY_ID / ALIYUN_SMS_ACCESS_KEY_SECRET（建议使用仅授权短信的 RAM 子账号）
 *   ALIYUN_SMS_SIGN_NAME（已审核通过的签名，如「基规智学」）
 *   ALIYUN_SMS_TEMPLATE_CODE（已审核通过的验证码模板 CODE，模板内容需含 ${code} 变量）
 */

let client: Dysmsapi20170525 | null = null;

function getClient() {
  if (client) return client;
  const config = new $OpenApi.Config({
    accessKeyId: process.env.ALIYUN_SMS_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_SMS_ACCESS_KEY_SECRET,
  });
  config.endpoint = "dysmsapi.aliyuncs.com";
  client = new Dysmsapi20170525(config);
  return client;
}

export async function sendSmsCode(phone: string, code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const req = new $Dysmsapi20170525.SendSmsRequest({
      phoneNumbers: phone, // 支持 +86138xxxxxxxx 国际格式
      signName: process.env.ALIYUN_SMS_SIGN_NAME,
      templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE,
      templateParam: JSON.stringify({ code }),
    });
    const res = await getClient().sendSms(req);
    if (res.body?.code !== "OK") {
      console.error("[aliyun-sms]", res.body?.code, res.body?.message);
      return { ok: false, error: res.body?.message || "发送失败" };
    }
    return { ok: true };
  } catch (err: any) {
    console.error("[aliyun-sms]", err?.message || err);
    return { ok: false, error: err?.message || "发送失败" };
  }
}
