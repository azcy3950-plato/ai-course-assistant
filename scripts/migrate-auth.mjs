/**
 * 统一账号体系数据库迁移（幂等，可重复执行）：
 *   node --env-file=.env.local scripts/migrate-auth.mjs
 *
 * - users.email 改为可空；新增 phone、token_version 列
 * - 新增验证码表 verification_codes 与认证审计表 auth_audit
 * - 与 src/lib/auth-identifiers.ts 的 ensureAuthSchema 保持一致（懒初始化兜底）
 */
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("缺少 DATABASE_URL。请使用 node --env-file=.env.local scripts/migrate-auth.mjs 运行。");
  }

  await pool.query("ALTER TABLE users ALTER COLUMN email DROP NOT NULL").catch(() => {});
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users(phone) WHERE phone IS NOT NULL");
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_has_identifier') THEN
        ALTER TABLE users ADD CONSTRAINT users_has_identifier CHECK (email IS NOT NULL OR phone IS NOT NULL);
      END IF;
    END $$;
  `);
  await pool.query(`
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_audit (
      id BIGSERIAL PRIMARY KEY,
      event TEXT NOT NULL,
      identifier TEXT,
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS auth_audit_created ON auth_audit(created_at DESC);
  `);

  const users = await pool.query("SELECT count(*)::int AS c FROM users");
  console.log(`迁移完成：users ${users.rows[0].c} 行（存量数据保留），新增 phone/token_version 列、verification_codes 表、auth_audit 表`);
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    pool.end();
  });
