import { Pool } from "pg";
import crypto from "crypto";
import { sign as jwtSign } from "jsonwebtoken";

/**
 * 统一账号体系核心库：手机号/邮箱规范化、验证码全生命周期、限流、
 * 审计与发送 Provider 抽象。沿用项目「模块级 Pool + 懒建表」模式。
 */

export const authPool = new Pool({ connectionString: process.env.DATABASE_URL });
let schemaPromise: Promise<void> | null = null;

export type IdentifierType = "EMAIL" | "PHONE";
export type CodePurpose = "REGISTER" | "RESET_PASSWORD";

// ─── 规范化与识别 ───
export function normalizeIdentifier(value: unknown): { identifier: string; type: IdentifierType } | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  // 邮箱：trim + lowercase
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    return { identifier: v.toLowerCase(), type: "EMAIL" };
  }
  // 手机号：去空格/括号/短横后识别；中国大陆 11 位统一为 +86 国际格式
  const digits = v.replace(/[\s()-]/g, "");
  if (/^(\+?86)?1[3-9]\d{9}$/.test(digits)) {
    return { identifier: "+86" + digits.replace(/^\+?86/, ""), type: "PHONE" };
  }
  // 其他国际号码：保留原样
  if (/^\+\d{8,15}$/.test(digits)) {
    return { identifier: digits, type: "PHONE" };
  }
  return null;
}

/** 脱敏展示：t***@example.com / 138****1234 */
export function maskIdentifier(identifier: string, type: IdentifierType): string {
  if (type === "EMAIL") {
    const [u, d] = identifier.split("@");
    return `${u.slice(0, 1)}***@${d}`;
  }
  const local = identifier.startsWith("+86") ? identifier.slice(3) : identifier;
  if (local.length <= 7) return `${local.slice(0, 1)}***`;
  return `${local.slice(0, 3)}****${local.slice(-4)}`;
}

// ─── 验证码生成与哈希（pepper + identifier 加盐，杜绝彩虹表） ───
const PEPPER = process.env.VERIFICATION_CODE_PEPPER || "aicourse-verification-pepper";

export function hashCode(identifier: string, code: string): string {
  return crypto.createHash("sha256").update(`${PEPPER}:${identifier}:${code}`).digest("hex");
}

export function generateCode(): string {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

// ─── 建表（懒初始化；与 scripts/migrate-auth.mjs 保持一致） ───
export async function ensureAuthSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await authPool.query("ALTER TABLE users ALTER COLUMN email DROP NOT NULL").catch(() => {});
      await authPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT");
      await authPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0");
      await authPool.query("CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users(phone) WHERE phone IS NOT NULL");
      await authPool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_has_identifier') THEN
            ALTER TABLE users ADD CONSTRAINT users_has_identifier CHECK (email IS NOT NULL OR phone IS NOT NULL);
          END IF;
        END $$;
      `);
      await authPool.query(`
        CREATE TABLE IF NOT EXISTS verification_codes (
          id BIGSERIAL PRIMARY KEY,
          identifier TEXT NOT NULL,
          identifier_type TEXT NOT NULL CHECK (identifier_type IN ('EMAIL','PHONE')),
          purpose TEXT NOT NULL CHECK (purpose IN ('REGISTER','RESET_PASSWORD')),
          code_hash TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          attempt_count INT NOT NULL DEFAULT 0,
          consumed_at TIMESTAMPTZ,
          used_at TIMESTAMPTZ,
          last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS verification_codes_lookup
          ON verification_codes(identifier, identifier_type, purpose, created_at DESC);
      `);
      await authPool.query(`
        CREATE TABLE IF NOT EXISTS auth_audit (
          id BIGSERIAL PRIMARY KEY,
          event TEXT NOT NULL,
          identifier TEXT,
          detail TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS auth_audit_created ON auth_audit(created_at DESC);
      `);
    })();
    if (schemaPromise) return schemaPromise;
  }
  return schemaPromise;
}

/** 审计事件（只记脱敏标识，绝不记验证码/密码/token 明文） */
export async function auditEvent(event: string, identifier: string | null, detail?: string): Promise<void> {
  try {
    await authPool.query("INSERT INTO auth_audit (event, identifier, detail) VALUES ($1,$2,$3)", [event, identifier, detail || null]);
  } catch { /* 审计失败不影响主流程 */ }
}

// ─── 限流（进程内内存实现；单实例部署足够，重启即重置） ───
const SEND_COOLDOWN_MS = 60_000;      // 60 秒冷却
const SEND_HOURLY_MAX = 5;            // 每小时 5 次
const IP_HOURLY_MAX = 20;             // 单 IP 每小时 20 次

interface SendRecord { lastSentAt: number; hourlyCount: number; hourlyStart: number; }
const sendRecords = new Map<string, SendRecord>();
const ipRecords = new Map<string, { count: number; windowStart: number }>();

export function checkSendRateLimit(key: string, ip: string): { error: string; retryAfter?: number } | null {
  const now = Date.now();
  const rec = sendRecords.get(key);
  if (rec) {
    if (now - rec.lastSentAt < SEND_COOLDOWN_MS) {
      return { error: "验证码发送过于频繁，请稍后再试", retryAfter: Math.ceil((SEND_COOLDOWN_MS - (now - rec.lastSentAt)) / 1000) };
    }
    if (now - rec.hourlyStart < 3600_000 && rec.hourlyCount >= SEND_HOURLY_MAX) {
      return { error: "该账号验证码发送次数已达上限，请 1 小时后再试", retryAfter: Math.ceil((3600_000 - (now - rec.hourlyStart)) / 1000) };
    }
  }
  const ipRec = ipRecords.get(ip);
  if (ipRec && now - ipRec.windowStart < 3600_000 && ipRec.count >= IP_HOURLY_MAX) {
    return { error: "发送过于频繁，请稍后再试" };
  }
  return null;
}

export function recordSend(key: string, ip: string): void {
  const now = Date.now();
  const rec = sendRecords.get(key);
  const hourlyStart = rec && now - rec.hourlyStart < 3600_000 ? rec.hourlyStart : now;
  const hourlyCount = rec && now - rec.hourlyStart < 3600_000 ? rec.hourlyCount + 1 : 1;
  sendRecords.set(key, { lastSentAt: now, hourlyCount, hourlyStart });
  const ipRec = ipRecords.get(ip);
  const ipStart = ipRec && now - ipRec.windowStart < 3600_000 ? ipRec.windowStart : now;
  const ipCount = ipRec && now - ipRec.windowStart < 3600_000 ? ipRec.count + 1 : 1;
  ipRecords.set(ip, { count: ipCount, windowStart: ipStart });
}

// ─── 发送 Provider 抽象（密钥一律走 ENV，不写死） ───
export interface DeliveryResult {
  ok: boolean;
  error?: string;
  /** 开发/演示模式回显验证码；仅在 VERIFICATION_CODE_ECHO=true 时返回 */
  echoCode?: string;
  provider: string;
}

export async function deliverCode(type: IdentifierType, target: string, code: string): Promise<DeliveryResult> {
  const isProd = process.env.NODE_ENV === "production";
  // 验证码回显只有显式设置 VERIFICATION_CODE_ECHO=true 才会启用（页面会标注开发测试模式）
  const echoEnabled = process.env.VERIFICATION_CODE_ECHO === "true";
  const masked = maskIdentifier(target, type);
  const provider = type === "EMAIL"
    ? (process.env.EMAIL_PROVIDER || "mock")
    : (process.env.SMS_PROVIDER || "mock");
  const channel = type === "EMAIL" ? "邮件" : "短信";

  // 真实服务分支（当前环境未配置，保持诚实失败；密钥一律走 ENV）
  if (provider === "smtp" && type === "EMAIL") {
    return { ok: false, error: "SMTP 服务不可用", provider };
  }
  if (provider === "aliyun" && type === "PHONE") {
    return { ok: false, error: "阿里云短信服务不可用", provider };
  }

  // 回显模式：必须显式开启
  if (provider === "echo" && echoEnabled) {
    console.log(`[auth][dev] ${channel} code requested for ${masked}`);
    return { ok: true, echoCode: code, provider: provider + "+echo" };
  }
  // provider 拼写为 echo 但未开全局开关：按未配置处理，绝不泄露
  if (provider === "echo") {
    return { ok: false, error: `${channel}服务未配置，请联系管理员`, provider };
  }

  // mock / console：仅开发环境可用；生产环境（除显式回显外）一律失败
  if (isProd && !echoEnabled) {
    return { ok: false, error: `${channel}服务未配置，请联系管理员`, provider };
  }
  if (echoEnabled) {
    console.log(`[auth][dev] ${channel} code requested for ${masked}`);
    return { ok: true, echoCode: code, provider: provider + "+echo" };
  }
  console.log(`[auth][dev] ${channel} code for ${masked}: ${code} (开发测试模式)`);
  return { ok: true, provider };
}

// ─── 发送验证码（含限流、旧码失效、防枚举审计） ───
export interface SendCodeResult {
  ok: boolean;
  status: number;
  error?: string;
  masked?: string;
  retryAfter?: number;
  echoCode?: string;
}

export async function sendVerificationCode(input: {
  identifier: string;
  type: IdentifierType;
  purpose: CodePurpose;
  ip: string;
}): Promise<SendCodeResult> {
  const { identifier, type, purpose, ip } = input;
  await ensureAuthSchema();

  const rate = checkSendRateLimit(`${identifier}|${purpose}`, ip);
  if (rate) return { ok: false, status: 429, error: rate.error, retryAfter: rate.retryAfter };

  if (purpose === "REGISTER") {
    const { rowCount } = await authPool.query("SELECT 1 FROM users WHERE email = $1 OR phone = $1 LIMIT 1", [identifier]);
    if ((rowCount ?? 0) > 0) {
      const label = type === "EMAIL" ? "该邮箱已注册" : "该手机号已注册";
      return { ok: false, status: 409, error: `${label}，请直接登录或找回密码` };
    }
  } else {
    // 找回密码：客户端不泄露账号是否存在，真实结果只进审计日志
    const { rowCount } = await authPool.query("SELECT 1 FROM users WHERE email = $1 OR phone = $1 LIMIT 1", [identifier]);
    await auditEvent("PASSWORD_RESET_CODE_SENT", maskIdentifier(identifier, type), `exists=${(rowCount ?? 0) > 0}`);
  }

  const code = generateCode();
  // 旧验证码立即失效（重新发送后旧码不可用）
  await authPool.query(
    "UPDATE verification_codes SET consumed_at = now() WHERE identifier = $1 AND purpose = $2 AND consumed_at IS NULL",
    [identifier, purpose],
  );
  await authPool.query(
    `INSERT INTO verification_codes (identifier, identifier_type, purpose, code_hash, expires_at)
     VALUES ($1,$2,$3,$4, now() + interval '5 minutes')`,
    [identifier, type, purpose, hashCode(identifier, code)],
  );

  const delivery = await deliverCode(type, identifier, code);
  if (!delivery.ok) return { ok: false, status: 500, error: delivery.error };

  recordSend(`${identifier}|${purpose}`, ip);
  if (purpose === "REGISTER") {
    await auditEvent("REGISTER_CODE_SENT", maskIdentifier(identifier, type));
  }
  return {
    ok: true,
    status: 200,
    masked: maskIdentifier(identifier, type),
    retryAfter: 60,
    echoCode: delivery.echoCode,
  };
}

// ─── 验证码校验（一次性使用；5 次错误即失效） ───
export async function consumeVerificationCode(
  identifier: string,
  type: IdentifierType,
  purpose: CodePurpose,
  code: string,
): Promise<boolean> {
  await ensureAuthSchema();
  const { rows } = await authPool.query(
    `SELECT * FROM verification_codes
     WHERE identifier = $1 AND identifier_type = $2 AND purpose = $3 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [identifier, type, purpose],
  );
  const row = rows[0];
  if (!row || new Date(row.expires_at) < new Date()) return false;
  if (row.attempt_count >= 5) return false;

  if (row.code_hash !== hashCode(identifier, code)) {
    const next = Number(row.attempt_count) + 1;
    await authPool.query(
      "UPDATE verification_codes SET attempt_count = $2, consumed_at = CASE WHEN $2 >= 5 THEN now() ELSE consumed_at END WHERE id = $1",
      [row.id, next],
    );
    return false;
  }
  await authPool.query("UPDATE verification_codes SET consumed_at = now() WHERE id = $1", [row.id]);
  return true;
}

/** 验证成功后为找回密码签发 10 分钟短期 reset token */
export function signResetToken(payload: { identifier: string; type: IdentifierType; purpose: CodePurpose; codeHash: string }): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET 未配置");
  return jwtSign(payload, secret, { expiresIn: "10m" });
}
