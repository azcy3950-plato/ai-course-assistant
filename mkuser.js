const { Pool } = require("pg");
const { hash } = require("bcryptjs");
(async () => {
  const pool = new Pool({ connectionString: "postgresql://aiuser:Ai123456@localhost:5432/aicourse" });
  const pw = await hash("531212", 10);
  await pool.query("DELETE FROM users WHERE email = $1", ["2407531842@qq.com"]);
  await pool.query("INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4)", ["2407531842@qq.com", pw, "老师", "teacher"]);
  console.log("OK - teacher created");
  await pool.end();
})();
