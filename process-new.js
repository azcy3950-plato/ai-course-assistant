const { Pool } = require("pg");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

async function main() {
  const databaseUrl = required("DATABASE_URL");
  const publicBaseUrl = required("OSS_PUBLIC_BASE_URL").replace(/\/$/, "");
  const since = required("PROCESS_SINCE");
  const apiUrl = process.env.PROCESS_API_URL || "http://localhost:3000/api/process-file";
  const token = process.env.PROCESS_FILE_TOKEN;
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const { rows } = await pool.query(
      "SELECT name, r2_key FROM documents WHERE created_at > $1",
      [since],
    );
    console.log(`待处理文档：${rows.length}`);

    for (const doc of rows) {
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          fileName: doc.name,
          fileUrl: `${publicBaseUrl}/${doc.r2_key}`,
        }),
      });
      const result = await response.json();
      console.log(`${doc.name}: ${result.message || result.error || response.status}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
