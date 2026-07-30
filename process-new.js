const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgresql://aiuser:Ai123456@localhost:5432/aicourse" });
(async () => {
  const { rows } = await pool.query("SELECT name, r2_key FROM documents WHERE created_at > $1", ["2026-07-23"]);
  console.log("Processing", rows.length, "new docs...");
  for (const doc of rows) {
    const fileUrl = "https://ai-course-assistant.oss-cn-beijing.aliyuncs.com/" + doc.r2_key;
    console.log("Processing:", doc.name);
    try {
      const r = await fetch("http://localhost:3000/api/process-file", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer system" },
        body: JSON.stringify({ fileName: doc.name, fileUrl })
      });
      const j = await r.json();
      console.log("  =>", j.message || j.error || "OK");
    } catch(e) { console.log("  => ERROR:", e.message); }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log("DONE");
  await pool.end();
})();
