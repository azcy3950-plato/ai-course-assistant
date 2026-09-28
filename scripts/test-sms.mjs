/**
 * 验证阿里云短信配置是否可用（发一条测试验证码短信）：
 *   node --env-file=.env.local scripts/test-sms.mjs 手机号
 */
import Dysmsapi20170525, * as $Dysmsapi20170525 from "@alicloud/dysmsapi20170525";
import * as $OpenApi from "@alicloud/openapi-client";

async function main() {
  const phone = process.argv[2];
  if (!phone) {
    throw new Error("用法：node --env-file=.env.local scripts/test-sms.mjs 手机号");
  }
  const required = ["ALIYUN_SMS_ACCESS_KEY_ID", "ALIYUN_SMS_ACCESS_KEY_SECRET", "ALIYUN_SMS_SIGN_NAME", "ALIYUN_SMS_TEMPLATE_CODE"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`缺少配置：${missing.join(", ")}`);
  }
  const config = new $OpenApi.Config({
    accessKeyId: process.env.ALIYUN_SMS_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_SMS_ACCESS_KEY_SECRET,
  });
  config.endpoint = "dysmsapi.aliyuncs.com";
  const client = new Dysmsapi20170525(config);
  const req = new $Dysmsapi20170525.SendSmsRequest({
    phoneNumbers: phone,
    signName: process.env.ALIYUN_SMS_SIGN_NAME,
    templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE,
    templateParam: JSON.stringify({ code: "123456" }),
  });
  const res = await client.sendSms(req);
  if (res.body?.code === "OK") {
    console.log("✅ 测试短信已发送（验证码 123456 仅用于验证通道）");
  } else {
    throw new Error(`短信接口返回：${res.body?.code} ${res.body?.message || ""}`);
  }
}

main().catch((e) => {
  console.error("❌ 发送失败：", e.message || e);
  process.exitCode = 1;
});
