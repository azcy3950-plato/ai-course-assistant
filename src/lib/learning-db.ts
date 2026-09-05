import { Pool, type PoolClient } from "pg";
import { buildAllNetworks } from "./knowledge-map-builder";

/**
 * 教学平台外围功能数据层：班级、学习任务、学生提交、教师反馈、
 * 学习事件、AI 问答存档与内容审核。
 *
 * 模式与 src/lib/knowledge-graph.ts 一致：模块级 Pool + 懒加载建表，
 * 首次调用时通过 ensureLearningSchema() 自动初始化表结构。
 */

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let schemaReady: Promise<void> | null = null;

// ─── 类型 ───
export type TaskType = "KNOWLEDGE" | "PRACTICE" | "GUIDED" | "SIMULATION" | "REMEDIAL";
export type StudentTaskStatus = "TODO" | "IN_PROGRESS" | "SUBMITTED" | "REVISION_REQUIRED" | "COMPLETED";
export type SubmissionStatus = "pending" | "passed" | "revision_required";
export type AiFeedbackStatus = "pending" | "resolved" | "dismissed";

export interface PracticeQuestion {
  q: string;
  options: string[];
  answer: string; // 正确选项文本；返回给学生时会被遮罩
  explanation?: string;
}

export interface TaskInput {
  title: string;
  description: string;
  type: TaskType;
  teacherEmail: string;
  classId: number | null;
  targetEmails: string[];
  knowledgeNodeIds: string[];
  questions: PracticeQuestion[];
  observeItems: string[];
  promptQuestions: string[];
  deadline: string | null;
}

// ─── 建表 ───
async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        teacher_email TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacher_email);

      CREATE TABLE IF NOT EXISTS class_members (
        class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (class_id, user_email)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL CHECK (type IN ('KNOWLEDGE','PRACTICE','GUIDED','SIMULATION','REMEDIAL')),
        teacher_email TEXT NOT NULL,
        class_id INT REFERENCES classes(id) ON DELETE SET NULL,
        target_emails TEXT[] NOT NULL DEFAULT '{}',
        knowledge_node_ids TEXT[] NOT NULL DEFAULT '{}',
        questions JSONB NOT NULL DEFAULT '[]',
        observe_items TEXT[] NOT NULL DEFAULT '{}',
        prompt_questions TEXT[] NOT NULL DEFAULT '{}',
        deadline TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_teacher ON tasks(teacher_email);

      CREATE TABLE IF NOT EXISTS student_tasks (
        task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO','IN_PROGRESS','SUBMITTED','REVISION_REQUIRED','COMPLETED')),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (task_id, user_email)
      );
      ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS completion_note TEXT;
      CREATE INDEX IF NOT EXISTS idx_student_tasks_email ON student_tasks(user_email);

      CREATE TABLE IF NOT EXISTS task_submissions (
        id SERIAL PRIMARY KEY,
        task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL,
        version INT NOT NULL DEFAULT 1,
        judgment TEXT NOT NULL DEFAULT '',
        explanation TEXT NOT NULL DEFAULT '',
        reflection TEXT NOT NULL DEFAULT '',
        answers JSONB NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','passed','revision_required')),
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_submissions_task ON task_submissions(task_id, user_email);

      CREATE TABLE IF NOT EXISTS teacher_feedback (
        id SERIAL PRIMARY KEY,
        submission_id INT NOT NULL REFERENCES task_submissions(id) ON DELETE CASCADE,
        teacher_email TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'passed' CHECK (status IN ('passed','revision_required')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS learning_events (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        ref_type TEXT,
        ref_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_events_email ON learning_events(user_email, created_at DESC);

      CREATE TABLE IF NOT EXISTS ai_qa_messages (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        references_data JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_qa_messages_email ON ai_qa_messages(user_email, created_at DESC);

      CREATE TABLE IF NOT EXISTS ai_content_feedback (
        id SERIAL PRIMARY KEY,
        message_id INT NOT NULL REFERENCES ai_qa_messages(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL,
        reason TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_feedback_status ON ai_content_feedback(status);

      CREATE TABLE IF NOT EXISTS ai_content_versions (
        id SERIAL PRIMARY KEY,
        message_id INT NOT NULL REFERENCES ai_qa_messages(id) ON DELETE CASCADE,
        version INT NOT NULL,
        content TEXT NOT NULL,
        edited_by TEXT NOT NULL,
        edit_reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (message_id, version)
      );

      CREATE TABLE IF NOT EXISTS practice_corrections (
        quiz_result_id INT PRIMARY KEY,
        user_email TEXT NOT NULL,
        corrected_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } finally {
    client.release();
  }
}

export function ensureLearningSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = initSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

// ─── 班级 ───
export async function listClasses(teacherEmail: string) {
  const { rows } = await pool.query(
    `SELECT c.*, (SELECT count(*)::int FROM class_members m WHERE m.class_id = c.id) AS member_count
     FROM classes c WHERE c.teacher_email = $1 ORDER BY c.created_at ASC`,
    [teacherEmail],
  );
  return rows;
}

export async function getClass(id: number) {
  const { rows } = await pool.query("SELECT * FROM classes WHERE id = $1", [id]);
  return rows[0] || null;
}

export async function createClass(teacherEmail: string, name: string) {
  const { rows } = await pool.query(
    "INSERT INTO classes (name, teacher_email) VALUES ($1, $2) RETURNING *",
    [name, teacherEmail],
  );
  return rows[0];
}

export async function deleteClass(id: number, teacherEmail: string) {
  const { rowCount } = await pool.query("DELETE FROM classes WHERE id = $1 AND teacher_email = $2", [id, teacherEmail]);
  return (rowCount ?? 0) > 0;
}

export async function addClassMember(classId: number, teacherEmail: string, userEmail: string) {
  const cls = await getClass(classId);
  if (!cls || cls.teacher_email !== teacherEmail) return { error: "无权操作该班级" };
  const exists = await pool.query("SELECT 1 FROM users WHERE email = $1", [userEmail]);
  if (exists.rowCount === 0) return { error: "该邮箱对应的学生账号不存在" };
  await pool.query(
    "INSERT INTO class_members (class_id, user_email) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [classId, userEmail],
  );
  return { ok: true };
}

export async function removeClassMember(classId: number, teacherEmail: string, userEmail: string) {
  const cls = await getClass(classId);
  if (!cls || cls.teacher_email !== teacherEmail) return { error: "无权操作该班级" };
  await pool.query("DELETE FROM class_members WHERE class_id = $1 AND user_email = $2", [classId, userEmail]);
  return { ok: true };
}

/** 班级学生列表 + 每人的任务/错题/最近活动聚合 */
export async function listClassStudents(classId: number, teacherEmail: string) {
  const cls = await getClass(classId);
  if (!cls || cls.teacher_email !== teacherEmail) return null;
  const { rows } = await pool.query(
    `SELECT m.user_email, u.name,
        (SELECT count(*)::int FROM student_tasks st WHERE st.user_email = m.user_email) AS task_total,
        (SELECT count(*)::int FROM student_tasks st WHERE st.user_email = m.user_email AND st.status = 'COMPLETED') AS task_done,
        (SELECT count(*)::int FROM quiz_results q WHERE q.user_email = m.user_email AND q.is_correct = false) AS quiz_wrong,
        (SELECT max(e.created_at) FROM learning_events e WHERE e.user_email = m.user_email) AS last_active
     FROM class_members m
     LEFT JOIN users u ON u.email = m.user_email
     WHERE m.class_id = $1
     ORDER BY u.name ASC NULLS LAST`,
    [classId],
  );
  return { cls, students: rows };
}

/** 教师能否查看某学生（必须在自己负责的班级内） */
export async function canTeacherViewStudent(teacherEmail: string, studentEmail: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM classes c JOIN class_members m ON m.class_id = c.id
     WHERE c.teacher_email = $1 AND m.user_email = $2 LIMIT 1`,
    [teacherEmail, studentEmail],
  );
  return (rowCount ?? 0) > 0;
}

/** 教师负责班级下的全部学生邮箱 */
export async function listTeacherStudentEmails(teacherEmail: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT m.user_email FROM classes c JOIN class_members m ON m.class_id = c.id
     WHERE c.teacher_email = $1`,
    [teacherEmail],
  );
  return rows.map((r) => r.user_email);
}

// ─── 任务 ───
export async function createTask(input: TaskInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO tasks (title, description, type, teacher_email, class_id, target_emails, knowledge_node_ids, questions, observe_items, prompt_questions, deadline)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        input.title, input.description, input.type, input.teacherEmail, input.classId,
        input.targetEmails, input.knowledgeNodeIds, JSON.stringify(input.questions),
        input.observeItems, input.promptQuestions,
        input.deadline ? new Date(input.deadline).toISOString() : null,
      ],
    );
    const task = rows[0];
    for (const email of input.targetEmails) {
      await client.query(
        "INSERT INTO student_tasks (task_id, user_email) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [task.id, email],
      );
    }
    await client.query("COMMIT");
    return task;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const EFFECTIVE_STATUS_SQL = `CASE
    WHEN st.status IN ('TODO','IN_PROGRESS') AND t.deadline IS NOT NULL AND t.deadline < now() THEN 'OVERDUE'
    ELSE st.status END`;

/** 教师视角任务列表（含进度统计） */
export async function listTeacherTasks(teacherEmail: string) {
  const { rows } = await pool.query(
    `SELECT t.*, c.name AS class_name,
        (SELECT count(*)::int FROM student_tasks st WHERE st.task_id = t.id) AS total,
        (SELECT count(*)::int FROM student_tasks st WHERE st.task_id = t.id AND st.status = 'COMPLETED') AS done,
        (SELECT count(*)::int FROM student_tasks st WHERE st.task_id = t.id AND st.status = 'SUBMITTED') AS submitted,
        (SELECT count(*)::int FROM student_tasks st WHERE st.task_id = t.id AND st.status = 'REVISION_REQUIRED') AS revision,
        (SELECT count(*)::int FROM student_tasks st WHERE st.task_id = t.id AND st.status IN ('TODO','IN_PROGRESS') AND (t.deadline IS NULL OR t.deadline >= now())) AS in_progress,
        (SELECT count(*)::int FROM student_tasks st WHERE st.task_id = t.id AND st.status IN ('TODO','IN_PROGRESS') AND t.deadline IS NOT NULL AND t.deadline < now()) AS overdue
     FROM tasks t LEFT JOIN classes c ON c.id = t.class_id
     WHERE t.teacher_email = $1
     ORDER BY t.created_at DESC`,
    [teacherEmail],
  );
  return rows;
}

/** 学生视角任务列表（含最近一次教师反馈） */
export async function listStudentTasks(email: string) {
  const { rows } = await pool.query(
    `SELECT t.*, c.name AS class_name, st.status, st.started_at, st.completed_at,
        ${EFFECTIVE_STATUS_SQL} AS effective_status,
        fb.content AS feedback_content, fb.status AS feedback_status, fb.created_at AS feedback_at
     FROM student_tasks st
     JOIN tasks t ON t.id = st.task_id
     LEFT JOIN classes c ON c.id = t.class_id
     LEFT JOIN LATERAL (
        SELECT f.content, f.status, f.created_at
        FROM task_submissions s JOIN teacher_feedback f ON f.submission_id = s.id
        WHERE s.task_id = t.id AND s.user_email = $1
        ORDER BY f.created_at DESC LIMIT 1
     ) fb ON true
     WHERE st.user_email = $1
     ORDER BY st.updated_at DESC`,
    [email],
  );
  return rows;
}

export async function getTask(id: number) {
  const { rows } = await pool.query(
    `SELECT t.*, c.name AS class_name FROM tasks t LEFT JOIN classes c ON c.id = t.class_id WHERE t.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function getStudentTask(taskId: number, email: string) {
  const { rows } = await pool.query(
    `SELECT st.*, ${EFFECTIVE_STATUS_SQL} AS effective_status
     FROM student_tasks st JOIN tasks t ON t.id = st.task_id
     WHERE st.task_id = $1 AND st.user_email = $2`,
    [taskId, email],
  );
  return rows[0] || null;
}

export async function listTaskTargets(taskId: number) {
  const { rows } = await pool.query(
    `SELECT st.*, u.name FROM student_tasks st LEFT JOIN users u ON u.email = st.user_email
     WHERE st.task_id = $1 ORDER BY u.name ASC NULLS LAST`,
    [taskId],
  );
  return rows;
}

/** 学生提交"标记完成"自评（教师端可见） */
export async function setStudentTaskNote(taskId: number, email: string, note: string) {
  await pool.query(
    "UPDATE student_tasks SET completion_note = $3, updated_at = now() WHERE task_id = $1 AND user_email = $2",
    [taskId, email, note],
  );
}

export async function setStudentTaskStatus(taskId: number, email: string, status: StudentTaskStatus, note?: string) {
  await pool.query(
    `UPDATE student_tasks SET status = $3, updated_at = now(),
        started_at = COALESCE(started_at, now()),
        completed_at = CASE WHEN $3 = 'COMPLETED' THEN now() ELSE completed_at END,
        completion_note = CASE WHEN $4 IS NULL THEN completion_note ELSE $4 END
     WHERE task_id = $1 AND user_email = $2`,
    [taskId, email, status, note ?? null],
  );
}

// ─── 提交与反馈 ───
export interface SubmissionInput {
  judgment: string;
  explanation: string;
  reflection: string;
  answers: any[];
}

export async function createSubmission(taskId: number, email: string, input: SubmissionInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ver = await client.query(
      "SELECT COALESCE(max(version), 0)::int + 1 AS v FROM task_submissions WHERE task_id = $1 AND user_email = $2",
      [taskId, email],
    );
    const version = ver.rows[0].v;
    const { rows } = await client.query(
      `INSERT INTO task_submissions (task_id, user_email, version, judgment, explanation, reflection, answers)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [taskId, email, version, input.judgment, input.explanation, input.reflection, JSON.stringify(input.answers)],
    );
    await client.query(
      `UPDATE student_tasks SET status = 'SUBMITTED', updated_at = now(), started_at = COALESCE(started_at, now())
       WHERE task_id = $1 AND user_email = $2`,
      [taskId, email],
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listTaskSubmissions(taskId: number) {
  const { rows } = await pool.query(
    `SELECT s.*, u.name AS student_name,
        f.content AS feedback_content, f.status AS feedback_status, f.created_at AS feedback_at
     FROM task_submissions s
     LEFT JOIN users u ON u.email = s.user_email
     LEFT JOIN LATERAL (
        SELECT content, status, created_at FROM teacher_feedback
        WHERE submission_id = s.id ORDER BY created_at DESC LIMIT 1
     ) f ON true
     WHERE s.task_id = $1 ORDER BY s.submitted_at DESC`,
    [taskId],
  );
  return rows;
}

export async function listStudentSubmissions(taskId: number, email: string) {
  const { rows } = await pool.query(
    `SELECT s.*, f.content AS feedback_content, f.status AS feedback_status, f.created_at AS feedback_at
     FROM task_submissions s
     LEFT JOIN LATERAL (
        SELECT content, status, created_at FROM teacher_feedback
        WHERE submission_id = s.id ORDER BY created_at DESC LIMIT 1
     ) f ON true
     WHERE s.task_id = $1 AND s.user_email = $2
     ORDER BY s.version DESC`,
    [taskId, email],
  );
  return rows;
}

/** 教师给提交写反馈；通过则任务完成，要求修改则退回 */
export async function addTeacherFeedback(submissionId: number, teacherEmail: string, content: string, status: "passed" | "revision_required") {
  const sub = await pool.query("SELECT * FROM task_submissions WHERE id = $1", [submissionId]);
  const submission = sub.rows[0];
  if (!submission) return null;
  const task = await getTask(submission.task_id);
  if (!task || task.teacher_email !== teacherEmail) return { error: "无权批阅该提交" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "INSERT INTO teacher_feedback (submission_id, teacher_email, content, status) VALUES ($1,$2,$3,$4) RETURNING *",
      [submissionId, teacherEmail, content, status],
    );
    await client.query("UPDATE task_submissions SET status = $2 WHERE id = $1", [submissionId, status === "passed" ? "passed" : "revision_required"]);
    await client.query(
      `UPDATE student_tasks SET status = $3, updated_at = now(), completed_at = CASE WHEN $3 = 'COMPLETED' THEN now() ELSE completed_at END
       WHERE task_id = $1 AND user_email = $2`,
      [submission.task_id, submission.user_email, status === "passed" ? "COMPLETED" : "REVISION_REQUIRED"],
    );
    await client.query("COMMIT");
    return { feedback: rows[0], submission };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** 学生收到的全部教师反馈（按时间倒序） */
export async function listFeedbackForStudent(email: string) {
  const { rows } = await pool.query(
    `SELECT f.*, t.title AS task_title, t.type AS task_type, t.id AS task_id, s.version AS submission_version
     FROM teacher_feedback f
     JOIN task_submissions s ON s.id = f.submission_id
     JOIN tasks t ON t.id = s.task_id
     WHERE s.user_email = $1
     ORDER BY f.created_at DESC LIMIT 50`,
    [email],
  );
  return rows;
}

// ─── 学习事件 ───
export async function addLearningEvent(input: {
  userEmail: string;
  type: string;
  title: string;
  summary?: string;
  refType?: string;
  refId?: string;
}) {
  await pool.query(
    `INSERT INTO learning_events (user_email, type, title, summary, ref_type, ref_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.userEmail, input.type, input.title, input.summary || "", input.refType || null, input.refId ? String(input.refId) : null],
  );
}

export async function listLearningEvents(email: string, limit = 100) {
  const { rows } = await pool.query(
    "SELECT * FROM learning_events WHERE user_email = $1 ORDER BY created_at DESC LIMIT $2",
    [email, limit],
  );
  return rows;
}

export async function markQuizCorrected(email: string, quizResultId: number) {
  await pool.query(
    "INSERT INTO practice_corrections (quiz_result_id, user_email) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [quizResultId, email],
  );
}

export async function listCorrectedQuizIds(email: string): Promise<Set<number>> {
  const { rows } = await pool.query("SELECT quiz_result_id FROM practice_corrections WHERE user_email = $1", [email]);
  return new Set(rows.map((r) => Number(r.quiz_result_id)));
}

// ─── AI 问答存档与审核 ───
export async function addQaMessage(input: { email: string; question: string; answer: string; references: any[] }) {
  const { rows } = await pool.query(
    "INSERT INTO ai_qa_messages (user_email, question, answer, references_data) VALUES ($1,$2,$3,$4) RETURNING *",
    [input.email, input.question, input.answer, JSON.stringify(input.references || [])],
  );
  return rows[0];
}

export async function listQaMessages(email: string, limit = 100) {
  const { rows } = await pool.query(
    `SELECT m.*,
        (SELECT count(*)::int FROM ai_content_feedback f WHERE f.message_id = m.id) AS feedback_count,
        (SELECT max(v.version) FROM ai_content_versions v WHERE v.message_id = m.id) AS latest_version
     FROM ai_qa_messages m WHERE m.user_email = $1 ORDER BY m.created_at DESC LIMIT $2`,
    [email, limit],
  );
  return rows;
}

export async function getQaMessage(id: number) {
  const { rows } = await pool.query("SELECT * FROM ai_qa_messages WHERE id = $1", [id]);
  return rows[0] || null;
}

export async function addAiFeedback(input: { messageId: number; email: string; reason: string; note: string }) {
  const { rows } = await pool.query(
    "INSERT INTO ai_content_feedback (message_id, user_email, reason, note) VALUES ($1,$2,$3,$4) RETURNING *",
    [input.messageId, input.email, input.reason, input.note],
  );
  return rows[0];
}

/** 教师审核列表：全部反馈 + 对应问答内容与版本 */
export async function listAiFeedback() {
  const { rows } = await pool.query(
    `SELECT f.*, m.question, m.answer, m.references_data,
        (SELECT max(v.version) FROM ai_content_versions v WHERE v.message_id = m.id) AS latest_version
     FROM ai_content_feedback f
     JOIN ai_qa_messages m ON m.id = f.message_id
     ORDER BY (f.status = 'pending') DESC, f.created_at DESC`,
  );
  return rows;
}

export async function updateAiFeedbackStatus(id: number, status: AiFeedbackStatus) {
  await pool.query("UPDATE ai_content_feedback SET status = $2 WHERE id = $1", [id, status]);
}

export async function listAiVersions(messageId: number) {
  const { rows } = await pool.query(
    "SELECT * FROM ai_content_versions WHERE message_id = $1 ORDER BY version ASC",
    [messageId],
  );
  return rows;
}

/** 教师修正 AI 回答：保留原回答为 V1，写入新版 V(n+1) */
export async function addAiVersion(input: { messageId: number; content: string; editedBy: string; editReason: string }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const msg = await client.query("SELECT * FROM ai_qa_messages WHERE id = $1", [input.messageId]);
    const message = msg.rows[0];
    if (!message) {
      await client.query("ROLLBACK");
      return null;
    }
    const existing = await client.query(
      "SELECT count(*)::int AS c FROM ai_content_versions WHERE message_id = $1",
      [input.messageId],
    );
    // 首次修正时，把 AI 原回答落为 V1
    if (existing.rows[0].c === 0) {
      await client.query(
        "INSERT INTO ai_content_versions (message_id, version, content, edited_by, edit_reason) VALUES ($1, 1, $2, $3, 'AI 原始回答')",
        [input.messageId, message.answer, message.user_email || "ai"],
      );
    }
    const ver = await client.query(
      "SELECT COALESCE(max(version), 0)::int + 1 AS v FROM ai_content_versions WHERE message_id = $1",
      [input.messageId],
    );
    const version = ver.rows[0].v;
    const { rows } = await client.query(
      `INSERT INTO ai_content_versions (message_id, version, content, edited_by, edit_reason)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.messageId, version, input.content, input.editedBy, input.editReason],
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── 学情分析 ───
/** 按知识点聚合：学习人数、平均掌握度、练习正确率、相关任务数 */
export async function nodeAnalysis(teacherEmail: string) {
  const studentEmails = await listTeacherStudentEmails(teacherEmail);
  if (studentEmails.length === 0) return [];

  // 运行时进度表存的节点 id 来自课程图谱（内存图谱），不是 knowledge_graph_nodes（历史远程同步表）。
  // 因此以课程图谱为名称/章节源，legacy 库表只做兜底（保留旧 id 行不丢）。
  const [progressRes, taskRes, legacyRes] = await Promise.all([
    pool.query(
      `SELECT node_id, count(*)::int AS student_count, round(avg(mastery)::numeric, 1) AS avg_mastery,
              COALESCE(sum(quiz_correct), 0)::int AS quiz_correct, COALESCE(sum(quiz_total), 0)::int AS quiz_total
       FROM student_node_progress WHERE user_email = ANY($1) GROUP BY node_id`,
      [studentEmails],
    ),
    pool.query("SELECT knowledge_node_ids FROM tasks WHERE teacher_email = $1", [teacherEmail]),
    pool.query("SELECT id, name, chapter FROM knowledge_graph_nodes").catch(() => ({ rows: [] })),
  ]);

  const nameMap = new Map<string, { name: string; chapter: string }>();
  for (const net of buildAllNetworks()) {
    for (const n of net.nodes) nameMap.set(n.id, { name: n.name, chapter: n.chapter });
  }
  for (const row of legacyRes.rows as Array<{ id: string; name: string; chapter: string }>) {
    if (!nameMap.has(row.id)) nameMap.set(row.id, { name: row.name, chapter: row.chapter });
  }

  const related = new Map<string, number>();
  for (const t of taskRes.rows as Array<{ knowledge_node_ids: string[] | null }>) {
    for (const id of t.knowledge_node_ids || []) related.set(id, (related.get(id) || 0) + 1);
  }

  return (progressRes.rows as Array<{
    node_id: string; student_count: number; avg_mastery: number | null;
    quiz_correct: number; quiz_total: number;
  }>)
    .map((row) => {
      const meta = nameMap.get(row.node_id) || { name: row.node_id, chapter: "" };
      return {
        id: row.node_id,
        name: meta.name,
        chapter: meta.chapter,
        category: "",
        student_count: row.student_count,
        avg_mastery: row.avg_mastery,
        quiz_correct: row.quiz_correct,
        quiz_total: row.quiz_total,
        related_tasks: related.get(row.node_id) || 0,
      };
    })
    .sort((a, b) => (a.avg_mastery ?? 0) - (b.avg_mastery ?? 0))
    .slice(0, 100);
}

/** 某知识点下的学生明细（掌握度 + 错题数） */
export async function nodeStudentDetail(nodeId: string, teacherEmail: string) {
  const studentEmails = await listTeacherStudentEmails(teacherEmail);
  if (studentEmails.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT p.user_email, u.name, p.mastery, p.quiz_correct, p.quiz_total, p.study_count, p.last_studied_at
     FROM student_node_progress p LEFT JOIN users u ON u.email = p.user_email
     WHERE p.node_id = $1 AND p.user_email = ANY($2)
     ORDER BY p.mastery ASC NULLS LAST`,
    [nodeId, studentEmails],
  );
  return rows;
}

/** 教师视角：任务常见错误（PRACTICE 提交的错题汇总） */
export async function taskErrorSummary(taskId: number) {
  const { rows } = await pool.query(
    `SELECT s.user_email, u.name, s.answers, s.version, s.submitted_at
     FROM task_submissions s LEFT JOIN users u ON u.email = s.user_email
     WHERE s.task_id = $1 AND s.answers IS NOT NULL AND jsonb_array_length(s.answers) > 0
     ORDER BY s.submitted_at DESC`,
    [taskId],
  );
  return rows;
}

/** 教师全部学生概览（按学生视角的学情分析） */
export async function teacherStudentsOverview(teacherEmail: string) {
  const { rows } = await pool.query(
    `SELECT m.user_email, u.name, string_agg(DISTINCT c.name, '、') AS class_names,
        (SELECT count(*)::int FROM student_tasks st WHERE st.user_email = m.user_email) AS task_total,
        (SELECT count(*)::int FROM student_tasks st WHERE st.user_email = m.user_email AND st.status = 'COMPLETED') AS task_done,
        (SELECT count(*)::int FROM quiz_results q WHERE q.user_email = m.user_email AND q.is_correct = false) AS quiz_wrong,
        (SELECT count(*)::int FROM quiz_results q WHERE q.user_email = m.user_email) AS quiz_total,
        (SELECT max(e.created_at) FROM learning_events e WHERE e.user_email = m.user_email) AS last_active
     FROM classes c JOIN class_members m ON m.class_id = c.id
     LEFT JOIN users u ON u.email = m.user_email
     WHERE c.teacher_email = $1
     GROUP BY m.user_email, u.name
     ORDER BY u.name ASC NULLS LAST`,
    [teacherEmail],
  );
  return rows;
}
