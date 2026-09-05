# 一次性补丁：向 learning-db.ts 注入新表 DDL 与 helper 函数
p = 'src/lib/learning-db.ts'
s = open(p, encoding='utf-8').read()

anchor = """    CREATE TABLE IF NOT EXISTS practice_corrections (
      quiz_result_id INT PRIMARY KEY,
      user_email TEXT NOT NULL,
      corrected_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);"""
new_tables = """    CREATE TABLE IF NOT EXISTS practice_corrections (
      quiz_result_id INT PRIMARY KEY,
      user_email TEXT NOT NULL,
      corrected_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_email ON notifications(user_email, created_at DESC);

    CREATE TABLE IF NOT EXISTS favorites (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      ref_type TEXT NOT NULL CHECK (ref_type IN ('node','qa_message','quiz_result')),
      ref_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      in_review BOOLEAN NOT NULL DEFAULT false,
      last_reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_email, ref_type, ref_id)
    );

    CREATE TABLE IF NOT EXISTS task_attachments (
      id SERIAL PRIMARY KEY,
      submission_id INT NOT NULL REFERENCES task_submissions(id) ON DELETE CASCADE,
      file_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INT NOT NULL DEFAULT 0,
      mime TEXT NOT NULL DEFAULT '',
      uploaded_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_submission ON task_attachments(submission_id);

    CREATE TABLE IF NOT EXISTS document_status (
      id SERIAL PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'UPLOADING' CHECK (status IN ('UPLOADING','PARSING','INDEXING','READY','FAILED')),
      chunk_count INT NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      uploaded_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      operator_email TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
  `);"""
assert anchor in s, 'anchor1 missing'
s = s.replace(anchor, new_tables, 1)

helpers = """

// ─── 通知中心 ───
export async function addNotification(input: {
  userEmail: string; type: string; title: string; body?: string; link?: string;
}) {
  await pool.query(
    "INSERT INTO notifications (user_email, type, title, body, link) VALUES ($1,$2,$3,$4,$5)",
    [input.userEmail, input.type, input.title, input.body || "", input.link || ""],
  );
}

export async function listNotifications(email: string, limit = 50) {
  const { rows } = await pool.query(
    "SELECT * FROM notifications WHERE user_email = $1 ORDER BY created_at DESC LIMIT $2",
    [email, limit],
  );
  return rows;
}

export async function unreadNotificationCount(email: string): Promise<number> {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS c FROM notifications WHERE user_email = $1 AND read_at IS NULL",
    [email],
  );
  return rows[0]?.c || 0;
}

export async function markNotificationRead(id: number, email: string) {
  await pool.query("UPDATE notifications SET read_at = now() WHERE id = $1 AND user_email = $2", [id, email]);
}

export async function markAllNotificationsRead(email: string) {
  await pool.query("UPDATE notifications SET read_at = now() WHERE user_email = $1 AND read_at IS NULL", [email]);
}

/** 惰性检查：学生任务截止 <24h 且未提醒 → 补发通知 */
export async function lazyDueSoonNotifications(email: string) {
  const { rows } = await pool.query(
    `SELECT st.task_id, t.title, t.deadline FROM student_tasks st
     JOIN tasks t ON t.id = st.task_id
     WHERE st.user_email = $1 AND st.status IN ('TODO','IN_PROGRESS')
       AND t.deadline IS NOT NULL AND t.deadline BETWEEN now() AND now() + interval '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.user_email = $1 AND n.type = 'TASK_DUE_SOON' AND n.link = '/tasks/' || t.id
       )`,
    [email],
  );
  for (const r of rows) {
    await addNotification({
      userEmail: email, type: "TASK_DUE_SOON",
      title: `任务即将截止：${r.title}`,
      body: `截止时间 ${new Date(r.deadline).toLocaleString("zh-CN", { hour12: false })}`,
      link: `/tasks/${r.task_id}`,
    });
  }
  return rows.length;
}

// ─── 收藏与待复习 ───
export async function addFavorite(input: { email: string; refType: string; refId: string; note?: string }) {
  await pool.query(
    `INSERT INTO favorites (user_email, ref_type, ref_id, note)
     VALUES ($1,$2,$3,$4) ON CONFLICT (user_email, ref_type, ref_id) DO NOTHING`,
    [input.email, input.refType, input.refId, input.note || ""],
  );
}

export async function removeFavorite(id: number, email: string) {
  await pool.query("DELETE FROM favorites WHERE id = $1 AND user_email = $2", [id, email]);
}

export async function setFavoriteReview(id: number, email: string, inReview: boolean) {
  await pool.query(
    "UPDATE favorites SET in_review = $3, last_reviewed_at = CASE WHEN $3 THEN last_reviewed_at ELSE now() END WHERE id = $1 AND user_email = $2",
    [id, email, inReview],
  );
}

export async function listFavorites(email: string) {
  const { rows } = await pool.query(
    "SELECT * FROM favorites WHERE user_email = $1 ORDER BY created_at DESC LIMIT 200",
    [email],
  );
  return rows;
}

// ─── 任务提交附件 ───
export async function addTaskAttachment(input: {
  submissionId: number; fileKey: string; fileName: string; fileSize: number; mime: string; uploadedBy: string;
}) {
  const { rows } = await pool.query(
    `INSERT INTO task_attachments (submission_id, file_key, file_name, file_size, mime, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.submissionId, input.fileKey, input.fileName, input.fileSize, input.mime, input.uploadedBy],
  );
  return rows[0];
}

export async function listSubmissionAttachments(submissionId: number) {
  const { rows } = await pool.query(
    "SELECT * FROM task_attachments WHERE submission_id = $1 ORDER BY created_at ASC",
    [submissionId],
  );
  return rows;
}

export async function listTaskAttachments(taskId: number) {
  const { rows } = await pool.query(
    `SELECT a.*, s.user_email FROM task_attachments a
     JOIN task_submissions s ON s.id = a.submission_id
     WHERE s.task_id = $1 ORDER BY a.created_at ASC`,
    [taskId],
  );
  return rows;
}

// ─── 知识库文档解析状态 ───
export async function upsertDocumentStatus(input: {
  fileKey: string; fileName: string; status: string; chunkCount?: number; error?: string; uploadedBy: string;
}) {
  const { rows } = await pool.query(
    `INSERT INTO document_status (file_name, file_key, status, chunk_count, error, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (file_key) DO UPDATE SET status = EXCLUDED.status,
       chunk_count = EXCLUDED.chunk_count, error = EXCLUDED.error, updated_at = now()
     RETURNING *`,
    [input.fileName, input.fileKey, input.status, input.chunkCount || 0, input.error || "", input.uploadedBy],
  );
  return rows[0];
}

export async function listDocumentStatus() {
  const { rows } = await pool.query("SELECT * FROM document_status ORDER BY created_at DESC LIMIT 200");
  return rows;
}

export async function getDocumentStatus(fileKey: string) {
  const { rows } = await pool.query("SELECT * FROM document_status WHERE file_key = $1", [fileKey]);
  return rows[0] || null;
}
"""
s = s.rstrip() + '\n' + helpers
open(p, 'w', encoding='utf-8').write(s)
print('learning-db extended OK')
