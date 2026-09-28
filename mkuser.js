const { Pool } = require("pg");
const { hash } = require("bcryptjs");

async function main() {
  const [rawEmail, password, name = "教师", role = "teacher"] = process.argv.slice(2);
  if (!["student", "teacher", "admin"].includes(role)) {
    throw new Error("角色必须是 student / teacher / admin");
  }
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!process.env.DATABASE_URL) {
    throw new Error("缺少 DATABASE_URL。可使用 node --env-file=.env.local mkuser.js ... 运行。");
  }
  if (!email || !password) {
    throw new Error("用法：node --env-file=.env.local mkuser.js <邮箱> <密码> [姓名] [角色]");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const passwordHash = await hash(password, 10);
    await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           role = EXCLUDED.role`,
      [email, passwordHash, name, role],
    );
    console.log(`用户已创建或更新：${email}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
