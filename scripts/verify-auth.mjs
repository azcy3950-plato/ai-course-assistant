/**
 * 统一账号体系验收测试（在部署服务器上执行，覆盖提示词第 27 节 A-K 全部场景）：
 *   BASE_URL=http://127.0.0.1:3000 node --env-file=.env.local scripts/verify-auth.mjs
 *
 * 前置条件：服务端已开启演示模式（VERIFICATION_CODE_ECHO=true），
 * 否则无法取得验证码明文，测试会明确失败提示。
 * 每个用例使用独立标识符，避免触发 60 秒发送冷却；
 * J（重复注册）刻意等待冷却期结束，验证真实产品行为。
 * 测试产生的临时账号会在结束时自动清理。
 */
import { Pool } from "pg";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ts = Date.now();
const PASSWORD = "AuthTest123";
const NEW_PASSWORD = "NewPass456";
const EMAIL = `auth-a-${ts}@demo.test`;
const PHONE = "+86138" + String(ts).slice(-8);
const createdUsers = [];
const results = [];
let failed = 0;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, data };
}

async function sendCode(identifier, purpose) {
  const r = await post("/api/auth/verification/send", { identifier, purpose });
  if (!r.data?.echoCode) throw new Error(`未返回验证码（echoCode）。请确认服务端 VERIFICATION_CODE_ECHO=true，响应: ${JSON.stringify(r.data)}`);
  return r;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cleanup() {
  if (createdUsers.length === 0) return;
  await pool.query(
    "DELETE FROM users WHERE email = ANY($1) OR phone = ANY($2)",
    [createdUsers.filter((u) => u.includes("@")), createdUsers.filter((u) => u.startsWith("+"))],
  ).catch(() => {});
  await pool.query("DELETE FROM verification_codes WHERE identifier = ANY($1)", [createdUsers]).catch(() => {});
}

async function main() {
  console.log(`验收测试：${BASE}\n`);

  // ── A. 邮箱验证码注册 + 邮箱登录 ──
  try {
    let r = await sendCode(EMAIL, "REGISTER");
    record("A1 邮箱发送验证码", r.status === 200 && !!r.data.masked, `masked=${r.data.masked}`);
    r = await post("/api/auth/register", { identifier: EMAIL, code: r.data.echoCode, password: PASSWORD, name: "验收测试A" });
    record("A2 邮箱验证码注册", r.status === 200, r.data?.error || "");
    if (r.status === 200) createdUsers.push(EMAIL);
    r = await post("/api/auth/login", { identifier: EMAIL, password: PASSWORD });
    record("A3 邮箱登录", r.status === 200 && !!r.data?.token);
  } catch (e) { record("A 邮箱注册登录", false, e.message); }

  // ── B. 手机号验证码注册 + 手机号登录 ──
  try {
    let r = await sendCode(PHONE, "REGISTER");
    record("B1 手机号发送验证码", r.status === 200 && !!r.data.masked, `masked=${r.data.masked}`);
    r = await post("/api/auth/register", { identifier: PHONE, code: r.data.echoCode, password: PASSWORD, name: "验收测试B" });
    record("B2 手机号验证码注册", r.status === 200, r.data?.error || "");
    if (r.status === 200) createdUsers.push(PHONE);
    r = await post("/api/auth/login", { identifier: PHONE, password: PASSWORD });
    record("B3 手机号登录", r.status === 200 && !!r.data?.token);
    r = await post("/api/auth/login", { email: PHONE, password: PASSWORD });
    record("B4 旧 email 字段兼容登录", r.status === 200 && !!r.data?.token);
  } catch (e) { record("B 手机号注册登录", false, e.message); }

  // ── C. 邮箱找回密码（全链路） ──
  try {
    let r = await sendCode(EMAIL, "RESET_PASSWORD");
    record("C1 找回密码发送验证码", r.status === 200);
    r = await post("/api/auth/verification/verify", { identifier: EMAIL, purpose: "RESET_PASSWORD", code: r.data.echoCode });
    record("C2 验证码验证", r.status === 200 && !!r.data?.resetToken);
    const resetToken = r.data?.resetToken;
    r = await post("/api/auth/password/reset", { identifier: EMAIL, resetToken, newPassword: NEW_PASSWORD });
    record("C3 设置新密码", r.status === 200, r.data?.error || "");
    r = await post("/api/auth/login", { identifier: EMAIL, password: PASSWORD });
    record("C4 旧密码登录失败", r.status === 401);
    r = await post("/api/auth/login", { identifier: EMAIL, password: NEW_PASSWORD });
    record("C5 新密码登录成功", r.status === 200 && !!r.data?.token);
  } catch (e) { record("C 邮箱找回密码", false, e.message); }

  // ── D. 手机号找回密码（全链路） ──
  try {
    let r = await sendCode(PHONE, "RESET_PASSWORD");
    r = await post("/api/auth/verification/verify", { identifier: PHONE, purpose: "RESET_PASSWORD", code: r.data.echoCode });
    record("D1 手机号验证码验证", r.status === 200 && !!r.data?.resetToken);
    const resetToken = r.data?.resetToken;
    r = await post("/api/auth/password/reset", { identifier: PHONE, resetToken, newPassword: NEW_PASSWORD });
    record("D2 手机号设置新密码", r.status === 200, r.data?.error || "");
    r = await post("/api/auth/login", { identifier: PHONE, password: NEW_PASSWORD });
    record("D3 手机号新密码登录", r.status === 200 && !!r.data?.token);
  } catch (e) { record("D 手机号找回密码", false, e.message); }

  // ── E. 过期验证码（独立邮箱，直接改库模拟过期） ──
  try {
    const eEmail = `auth-e-${ts}@demo.test`;
    const r0 = await sendCode(eEmail, "RESET_PASSWORD");
    await pool.query("UPDATE verification_codes SET expires_at = now() - interval '1 minute' WHERE identifier = $1 AND purpose = 'RESET_PASSWORD' AND consumed_at IS NULL", [eEmail]);
    const r = await post("/api/auth/verification/verify", { identifier: eEmail, purpose: "RESET_PASSWORD", code: r0.data.echoCode });
    record("E 过期验证码拒绝", r.status === 400);
    await pool.query("DELETE FROM verification_codes WHERE identifier = $1", [eEmail]);
  } catch (e) { record("E 过期验证码", false, e.message); }

  // ── F. 错误验证码（独立邮箱） ──
  try {
    const fEmail = `auth-f-${ts}@demo.test`;
    await sendCode(fEmail, "RESET_PASSWORD");
    const r = await post("/api/auth/verification/verify", { identifier: fEmail, purpose: "RESET_PASSWORD", code: "000000" });
    record("F 错误验证码拒绝", r.status === 400 && !/内部|未配置/.test(r.data?.error || ""));
    await pool.query("DELETE FROM verification_codes WHERE identifier = $1", [fEmail]);
  } catch (e) { record("F 错误验证码", false, e.message); }

  // ── G. 已使用验证码再次使用（独立邮箱） ──
  try {
    const gEmail = `auth-g-${ts}@demo.test`;
    const r0 = await sendCode(gEmail, "RESET_PASSWORD");
    const r1 = await post("/api/auth/verification/verify", { identifier: gEmail, purpose: "RESET_PASSWORD", code: r0.data.echoCode });
    const firstOk = r1.status === 200;
    const r2 = await post("/api/auth/verification/verify", { identifier: gEmail, purpose: "RESET_PASSWORD", code: r0.data.echoCode });
    record("G 已使用验证码拒绝", firstOk && r2.status === 400);
    await pool.query("DELETE FROM verification_codes WHERE identifier = $1", [gEmail]);
  } catch (e) { record("G 已使用验证码", false, e.message); }

  // ── H. 60 秒内重复发送（独立邮箱） ──
  try {
    const hEmail = `auth-h-${ts}@demo.test`;
    const r1 = await sendCode(hEmail, "REGISTER");
    const r2 = await post("/api/auth/verification/send", { identifier: hEmail, purpose: "REGISTER" });
    record("H 60 秒内重复发送被拒", r1.status === 200 && r2.status === 429);
    await pool.query("DELETE FROM verification_codes WHERE identifier = $1", [hEmail]);
  } catch (e) { record("H 重复发送限流", false, e.message); }

  // ── I. 不存在账号找回密码：防枚举（独立标识符，对比响应形状） ──
  try {
    const ghost = `auth-ghost-${ts}@demo.test`;
    const real = `auth-i-real-${ts}@demo.test`;
    // 先注册一个真实账号（REGISTER 限流键独立），保证其 RESET_PASSWORD 发送不处于冷却期
    const reg = await sendCode(real, "REGISTER");
    await post("/api/auth/register", { identifier: real, code: reg.data.echoCode, password: PASSWORD, name: "验收测试I" });
    createdUsers.push(real);
    const rGhost = await sendCode(ghost, "RESET_PASSWORD");
    const rReal = await sendCode(real, "RESET_PASSWORD");
    const sameShape = rGhost.status === rReal.status && !!rGhost.data?.masked === !!rReal.data?.masked;
    const noLeak = !/不存在|未注册/.test(JSON.stringify(rGhost.data || ""));
    record("I 防枚举：响应不泄露账号是否存在", sameShape && noLeak);
    await pool.query("DELETE FROM verification_codes WHERE identifier = ANY($1)", [[ghost, real]]);
  } catch (e) { record("I 防枚举", false, e.message); }

  // ── K. 原有账号与角色保持正常 ──
  try {
    let r = await post("/api/auth/login", { identifier: "teacher@demo.edu.cn", password: "Demo123456" });
    record("K1 教师演示账号登录", r.status === 200 && r.data?.user?.role === "teacher");
    const token = r.data?.token;
    if (token) {
      const me = await fetch(BASE + "/api/auth/me", { headers: { Authorization: "Bearer " + token } });
      record("K2 教师会话校验 /me", me.status === 200);
    }
    r = await post("/api/auth/login", { identifier: "student01@demo.edu.cn", password: "Demo123456" });
    record("K3 学生演示账号登录", r.status === 200 && r.data?.user?.role === "student");
  } catch (e) { record("K 原有账号", false, e.message); }

  // ── J. 重复注册（等待 A1 的 60 秒发送冷却结束，验证真实产品行为） ──
  console.log("\n等待 60 秒发送冷却结束后测试 J（重复注册）…");
  await sleep(61_000);
  try {
    const r = await post("/api/auth/verification/send", { identifier: EMAIL, purpose: "REGISTER" });
    record("J 重复邮箱注册提示", r.status === 409 && /已注册/.test(r.data?.error || ""), r.data?.error || "");
  } catch (e) { record("J 重复注册", false, e.message); }

  console.log(`\n结果：${results.length - failed}/${results.length} 通过${failed ? `，${failed} 失败` : ""}`);
  await cleanup();
  console.log("临时测试账号已清理");
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("测试执行异常:", error.message);
    await cleanup();
    pool.end();
    process.exitCode = 1;
  });
