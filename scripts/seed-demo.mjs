/**
 * 演示数据 seed 脚本（在部署服务器上运行）：
 *   node --env-file=.env.local scripts/seed-demo.mjs
 *
 * 创建固定的匿名演示账号、班级、学习任务、提交/批阅、学习事件、
 * 问答记录、知识点进度、错题与 AI 问答存档，均为可复现的演示数据（不使用随机数）。
 * 登录信息（演示）：
 *   教师：teacher@demo.edu.cn / Demo123456
 *   学生：student01..12@demo.edu.cn / Demo123456
 */
import { readFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { hash } from "bcryptjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const DEMO_PASSWORD = "Demo123456";

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function hoursAgo(h) {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}
function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

async function ensureSchema() {
  await pool.query(`
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

    -- ── 平台基础表（历史上手工建，这里补成自包含；幂等） ──
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      avatar TEXT,
      last_login TIMESTAMPTZ,
      token_version INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS quiz_results (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      question TEXT NOT NULL,
      correct_answer TEXT,
      student_answer TEXT,
      is_correct BOOLEAN,
      topic TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS explanation TEXT NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS learning_records (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      question TEXT NOT NULL,
      answer_summary TEXT NOT NULL DEFAULT '',
      keywords TEXT[] NOT NULL DEFAULT '{}',
      topics TEXT[] NOT NULL DEFAULT '{}',
      has_references BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      in_review BOOLEAN NOT NULL DEFAULT false,
      last_reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_email, ref_type, ref_id)
    );

    CREATE TABLE IF NOT EXISTS direct_messages (
      id SERIAL PRIMARY KEY,
      student_email TEXT NOT NULL,
      teacher_email TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      body TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_dm_thread ON direct_messages(student_email, teacher_email, id);
    CREATE INDEX IF NOT EXISTS idx_dm_unread_student ON direct_messages(student_email, id)
      WHERE read_at IS NULL AND sender_email <> student_email;
    CREATE INDEX IF NOT EXISTS idx_dm_unread_teacher ON direct_messages(teacher_email, id)
      WHERE read_at IS NULL AND sender_email <> teacher_email;
  `);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("缺少 DATABASE_URL。请使用 node --env-file=.env.local scripts/seed-demo.mjs 运行。");
  }
  await ensureSchema();

  const teacher = "teacher@demo.edu.cn";
  const students = [];
  for (let i = 1; i <= 12; i++) students.push(`student${String(i).padStart(2, "0")}@demo.edu.cn`);
  const demoEmails = [teacher, ...students];

  // ── 清理旧的演示数据（幂等） ──
  await pool.query("DELETE FROM tasks WHERE teacher_email = $1", [teacher]);
  await pool.query("DELETE FROM classes WHERE teacher_email = $1", [teacher]);
  await pool.query("DELETE FROM practice_corrections WHERE user_email = ANY($1)", [demoEmails]);
  await pool.query("DELETE FROM quiz_results WHERE user_email = ANY($1)", [demoEmails]);
  await pool.query("DELETE FROM learning_events WHERE user_email = ANY($1)", [demoEmails]);
  await pool.query("DELETE FROM ai_qa_messages WHERE user_email = ANY($1)", [demoEmails]);
  await pool.query("DELETE FROM learning_records WHERE user_email = ANY($1)", [demoEmails]);
  await pool.query("DELETE FROM student_node_progress WHERE user_email = ANY($1)", [demoEmails]);
  await pool.query("DELETE FROM direct_messages WHERE student_email = ANY($1) OR teacher_email = ANY($1)", [demoEmails]);

  // ── 1. 用户 ──
  const pwHash = await hash(DEMO_PASSWORD, 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = EXCLUDED.role`,
    [teacher, pwHash, "张老师", "teacher"],
  );
  await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = EXCLUDED.role`,
    ["admin@demo.edu.cn", pwHash, "管理员", "admin"],
  );
  // 空数据教师账号：无班级无任务，用于验收仪表盘/消息页全空态
  await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = EXCLUDED.role`,
    ["teacherEmpty@demo.edu.cn", pwHash, "空数据老师", "teacher"],
  );
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'").catch(() => {});
  for (let i = 0; i < 12; i++) {
    await pool.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = EXCLUDED.role`,
      [students[i], pwHash, `学生${String(i + 1).padStart(2, "0")}`, "student"],
    );
  }

  // ── 2. 班级 ──
  const c1 = (await pool.query("INSERT INTO classes (name, teacher_email) VALUES ('排水231班', $1) RETURNING id", [teacher])).rows[0].id;
  const c2 = (await pool.query("INSERT INTO classes (name, teacher_email) VALUES ('排水232班', $1) RETURNING id", [teacher])).rows[0].id;
  for (let i = 0; i < 8; i++) {
    await pool.query("INSERT INTO class_members (class_id, user_email) VALUES ($1,$2) ON CONFLICT DO NOTHING", [c1, students[i]]);
  }
  for (let i = 8; i < 12; i++) {
    await pool.query("INSERT INTO class_members (class_id, user_email) VALUES ($1,$2) ON CONFLICT DO NOTHING", [c2, students[i]]);
  }
  const class231 = students.slice(0, 8);

  // ── 3. 知识点目录（scripts/node-catalog.json，与运行时内存图谱一致的节点 id） ──
  // 固定演示数据：按名称硬编码选取排水网络节点（可复现，不用随机；演示数据）
  const catalog = JSON.parse(readFileSync(join(process.cwd(), "scripts", "node-catalog.json"), "utf-8"));
  const DEMO_NODE_NAMES = ["排水工程", "体制", "分流制", "合流制", "雨水", "雨水量计算", "设计流量", "管渠水力", "排水系统组成", "平面布置", "排水量估算"];
  const demoNodes = DEMO_NODE_NAMES
    .map((name) => catalog.find((c) => c.net === "drainage" && c.name === name))
    .filter(Boolean);
  const pick = (n) => demoNodes.slice(0, n).map((x) => x.id);
  const nodeName = (id) => demoNodes.find((x) => x.id === id)?.name || id;

  // ── 4. 任务 ──
  const insertTask = async (t) => {
    const r = await pool.query(
      `INSERT INTO tasks (title, description, type, teacher_email, class_id, target_emails, knowledge_node_ids, questions, observe_items, prompt_questions, deadline, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        t.title, t.description, t.type, teacher, t.classId, t.targets, t.nodeIds || [],
        JSON.stringify(t.questions || []), t.observe || [], t.prompt || [], t.deadline, t.createdAt,
      ],
    );
    const id = r.rows[0].id;
    for (const em of t.targets) {
      await pool.query("INSERT INTO student_tasks (task_id, user_email) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, em]);
    }
    return id;
  };
  const setStatus = async (taskId, email, status, startedDaysAgo, completedDaysAgo) => {
    await pool.query(
      `UPDATE student_tasks SET status = $3, updated_at = now(),
        started_at = COALESCE(started_at, $4),
        completed_at = $5
       WHERE task_id = $1 AND user_email = $2`,
      [taskId, email, status, startedDaysAgo ? daysAgo(startedDaysAgo) : null, completedDaysAgo ? daysAgo(completedDaysAgo) : null],
    );
  };

  const tk1 = await insertTask({
    title: "城市排水系统基础", type: "KNOWLEDGE", classId: c1, targets: class231,
    description: "围绕城市排水系统的基本组成、排水体制与产汇流原理，在知识问答中提问学习，并完成对应知识点的理解。",
    nodeIds: pick(5), deadline: daysFromNow(7), createdAt: daysAgo(7),
  });
  const tk2 = await insertTask({
    title: "下垫面方案比较", type: "SIMULATION", classId: c1, targets: class231,
    description: "在电子沙盘中分别比较不同下垫面方案（如不同不透水率）下的内涝响应，观察关键指标变化并给出你的判断。",
    observe: ["最大水深", "峰值流量", "满管情况"],
    prompt: ["你观察到什么？", "为什么出现这种结果？", "你会如何调整方案？"],
    deadline: daysFromNow(7), createdAt: daysAgo(6),
  });
  const tk3 = await insertTask({
    title: "排水体制引导探究", type: "GUIDED", classId: c1, targets: class231,
    description: "进入引导学习，围绕合流制与分流制的优缺点完成一轮探究式学习。",
    nodeIds: pick(3), deadline: daysFromNow(5), createdAt: daysAgo(5),
  });
  const tk4 = await insertTask({
    title: "设计重现期专项练习", type: "PRACTICE", classId: c1, targets: class231,
    description: "完成以下关于暴雨重现期与设计暴雨的专项练习。",
    questions: [
      { q: "设计暴雨重现期越大，对应的设计暴雨强度一般（　）", options: ["越大", "越小", "不变", "无法确定"], answer: "越大", explanation: "重现期越长，设计暴雨强度越大，管网设计标准越高。" },
      { q: "城市雨水管渠设计中，雨水口主要作用是（　）", options: ["汇集地面径流", "输送雨水", "净化水质", "蓄存雨水"], answer: "汇集地面径流", explanation: "雨水口收集地面雨水进入管渠系统。" },
      { q: "下列哪种设施属于源头削减措施？", options: ["雨水调蓄池", "绿色屋顶", "截流干管", "泵站"], answer: "绿色屋顶", explanation: "绿色屋顶在源头削减径流，属于源头控制（LID）措施。" },
    ],
    deadline: daysFromNow(3), createdAt: daysAgo(4),
  });
  const tk5 = await insertTask({
    title: "补充学习：雨水管网规划复习", type: "REMEDIAL", classId: null, targets: [students[2], students[6]],
    description: "针对课堂练习中暴露的问题，重新学习雨水管网规划相关知识，并在知识问答中就疑问提问。",
    nodeIds: pick(2), deadline: daysFromNow(4), createdAt: daysAgo(1),
  });

  // ── 排水232班任务（让第二个班级演示时同样有数据） ──
  const class232 = students.slice(8, 12);
  const tk6 = await insertTask({
    title: "雨水管网规划基础", type: "KNOWLEDGE", classId: c2, targets: class232,
    description: "围绕雨水管渠系统布置、汇水区划分与设计流量计算，在知识问答中提问学习。",
    nodeIds: pick(4), deadline: daysFromNow(6), createdAt: daysAgo(5),
  });
  const tk7 = await insertTask({
    title: "重现期情景对比", type: "SIMULATION", classId: c2, targets: class232,
    description: "在电子沙盘中分别用 2 年与 50 年重现期对应的降雨强度运行模拟，对比内涝响应差异。",
    observe: ["最大水深", "峰值流量"],
    prompt: ["两种情景下最大水深和峰值流量相差多少？", "重现期提高意味着什么设计代价？"],
    deadline: daysFromNow(5), createdAt: daysAgo(3),
  });
  const tk8 = await insertTask({
    title: "汇流计算小练习", type: "PRACTICE", classId: c2, targets: class232,
    description: "完成以下关于汇水区与设计流量的专项练习。",
    questions: [
      { q: "雨水管渠设计流量计算中，径流系数反映的是（　）", options: ["降雨转化为径流的比例", "管道粗糙程度", "管渠坡度", "降雨历时"], answer: "降雨转化为径流的比例", explanation: "径流系数为径流量与降雨量之比，反映产流特性。" },
      { q: "汇水区划分的基本原则是（　）", options: ["按地形分水线就近排入管渠", "面积越大越好", "跨排水片区随意划分", "只考虑道路走向"], answer: "按地形分水线就近排入管渠", explanation: "汇水区按地形分水线划分，使雨水就近进入管渠。" },
    ],
    deadline: daysFromNow(3), createdAt: daysAgo(2),
  });

  // ── 5. 任务状态 ──
  for (let i = 0; i < 5; i++) await setStatus(tk1, students[i], "COMPLETED", 6, 5 - i);
  await setStatus(tk1, students[5], "IN_PROGRESS", 3, null);
  await setStatus(tk1, students[6], "TODO", null, null);
  await setStatus(tk1, students[7], "TODO", null, null);

  await setStatus(tk2, students[0], "COMPLETED", 5, 3);
  await setStatus(tk2, students[1], "REVISION_REQUIRED", 5, null);
  await setStatus(tk2, students[2], "SUBMITTED", 4, null);
  await setStatus(tk2, students[4], "SUBMITTED", 2, null);
  await setStatus(tk2, students[5], "IN_PROGRESS", 1, null);

  for (let i = 0; i < 3; i++) await setStatus(tk3, students[i], "COMPLETED", 4, 3 - i);
  await setStatus(tk3, students[3], "IN_PROGRESS", 2, null);

  await setStatus(tk4, students[0], "COMPLETED", 3, 2);
  await setStatus(tk4, students[1], "SUBMITTED", 3, null);
  await setStatus(tk4, students[2], "SUBMITTED", 2, null);

  await setStatus(tk5, students[2], "COMPLETED", 1, 0);
  await setStatus(tk5, students[6], "IN_PROGRESS", 0, null);

  // 232 班任务状态
  await setStatus(tk6, students[8], "COMPLETED", 4, 3);
  await setStatus(tk6, students[9], "IN_PROGRESS", 2, null);
  await setStatus(tk6, students[10], "TODO", null, null);
  await setStatus(tk6, students[11], "TODO", null, null);

  await setStatus(tk7, students[8], "SUBMITTED", 2, null);
  await setStatus(tk7, students[9], "REVISION_REQUIRED", 2, null);
  await setStatus(tk7, students[10], "IN_PROGRESS", 1, null);

  await setStatus(tk8, students[8], "COMPLETED", 2, 1);
  await setStatus(tk8, students[9], "SUBMITTED", 1, null);

  // ── 6. 提交与教师批阅 ──
  const insertSubmission = async (taskId, email, version, fields, submittedHoursAgo, status) => {
    const r = await pool.query(
      `INSERT INTO task_submissions (task_id, user_email, version, judgment, explanation, reflection, answers, status, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [taskId, email, version, fields.judgment || "", fields.explanation || "", fields.reflection || "",
        JSON.stringify(fields.answers || []), status, hoursAgo(submittedHoursAgo)],
    );
    return r.rows[0].id;
  };
  const insertFeedback = async (submissionId, content, status, createdHoursAgo) => {
    await pool.query(
      "INSERT INTO teacher_feedback (submission_id, teacher_email, content, status, created_at) VALUES ($1,$2,$3,$4,$5)",
      [submissionId, teacher, content, status, hoursAgo(createdHoursAgo)],
    );
  };

  // 仿真任务 tk2
  const s1 = await insertSubmission(tk2, students[0], 1, {
    judgment: "不透水率提高后，峰值流量明显增大，最大水深出现在 J35 节点，出现满管和局部积水。",
    explanation: "不透水率提高使下渗减少、产流面积增大，汇流时间缩短，径流峰值随之增大。",
    reflection: "如果增加绿色屋顶等 LID 设施，预计峰值流量会下降，可以再跑一组对照实验验证。",
  }, 80, "passed");
  await insertFeedback(s1, "结论正确，解释清楚。反思中提到 LID 对照实验很好，可以实际跑一组对比并记录数据。", "passed", 70);

  const s2 = await insertSubmission(tk2, students[1], 1, {
    judgment: "最大水深变大了，很多管段满管。",
    explanation: "因为雨下得大。",
    reflection: "以后要注意排水。",
  }, 60, "revision_required");
  await insertFeedback(s2, "结论对但解释不足：没有说明不透水率变化为什么会影响峰值流量（下渗减少、产流增大）。请补充机理分析后重新提交。", "revision_required", 50);

  const s3 = await insertSubmission(tk2, students[2], 1, {
    judgment: "对比 60% 与 90% 不透水率两个方案，后者最大水深增加约 0.4m，峰值流量增大。",
    explanation: "不透水面增加后下渗损失减少，汇流更快，径流系数提高。",
    reflection: "可尝试加入 LID 设施观察削减效果。",
  }, 30, "pending");

  const s4 = await insertSubmission(tk2, students[4], 1, {
    judgment: "满管段数量随降雨强度增大而增多。",
    explanation: "降雨强度增大使管道流量增加，超过设计能力后满管。",
    reflection: "提高设计重现期可以缓解，但成本更高。",
  }, 10, "pending");

  // 232 班仿真任务 tk7 提交与批阅
  const s5 = await insertSubmission(tk7, students[8], 1, {
    judgment: "50 年重现期情景下最大水深约 2.1m，2 年情景约 1.5m，峰值流量相差约 30%。",
    explanation: "重现期提高对应更强的设计暴雨，管渠超载更严重。",
    reflection: "提高设计标准能缓解内涝，但工程造价会明显上升，需要在安全与经济之间权衡。",
  }, 40, "pending");

  const s6 = await insertSubmission(tk7, students[9], 1, {
    judgment: "重现期越大水深越大。",
    explanation: "雨变大了。",
    reflection: "无。",
  }, 25, "revision_required");
  await insertFeedback(s6, "结论太简略：需要给出两个情景的量化对比（最大水深、峰值流量的差值），并说明重现期提高的设计代价。", "revision_required", 20);

  // 232 班练习任务 tk8（服务端判分结果）
  const qs8 = [
    { q: "雨水管渠设计流量计算中，径流系数反映的是（　）", correct: "降雨转化为径流的比例" },
    { q: "汇水区划分的基本原则是（　）", correct: "按地形分水线就近排入管渠" },
  ];
  const mkAnswers8 = (rows) => rows.map((row, i) => ({
    index: i, question: qs8[i].q, studentAnswer: row[0], correctAnswer: qs8[i].correct,
    isCorrect: row[0] === qs8[i].correct,
  }));
  await insertSubmission(tk8, students[8], 1, { answers: mkAnswers8(["降雨转化为径流的比例", "按地形分水线就近排入管渠"]) }, 30, "passed");
  const p4 = await insertSubmission(tk8, students[9], 1, { answers: mkAnswers8(["管道粗糙程度", "按地形分水线就近排入管渠"]) }, 15, "pending");
  await insertFeedback(p4, "第 1 题错误：径流系数是降雨转化为径流的比例，不是管道粗糙程度。订正后重做。", "revision_required", 12);

  // 练习任务 tk4（服务端判分结果）
  const qs = [
    { q: "设计暴雨重现期越大，对应的设计暴雨强度一般（　）", correct: "越大" },
    { q: "城市雨水管渠设计中，雨水口主要作用是（　）", correct: "汇集地面径流" },
    { q: "下列哪种设施属于源头削减措施？", correct: "绿色屋顶" },
  ];
  const mkAnswers = (rows) => rows.map((row, i) => ({
    index: i, question: qs[i].q, studentAnswer: row[0], correctAnswer: qs[i].correct,
    isCorrect: row[0] === qs[i].correct,
  }));
  await insertSubmission(tk4, students[0], 1, { answers: mkAnswers(["越大", "汇集地面径流", "绿色屋顶"]) }, 50, "passed");
  const p2 = await insertSubmission(tk4, students[1], 1, { answers: mkAnswers(["越小", "输送雨水", "绿色屋顶"]) }, 45, "pending");
  const p3 = await insertSubmission(tk4, students[2], 1, { answers: mkAnswers(["越大", "输送雨水", "雨水调蓄池"]) }, 20, "pending");
  await insertFeedback(p2, "第 1、2 题错误：重现期与暴雨强度正相关；雨水口用于汇集地面径流而非输送。订正后重新作答。", "revision_required", 40);
  await insertFeedback(p3, "第 2、3 题错误，请复习排水系统组成与 LID 设施分类后重做。", "revision_required", 18);

  // ── 7. 学习事件 ──
  const insertEvent = async (email, type, title, summary, hoursAgoVal, refType = null, refId = null) => {
    await pool.query(
      "INSERT INTO learning_events (user_email, type, title, summary, ref_type, ref_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [email, type, title, summary, refType, refId, hoursAgo(hoursAgoVal)],
    );
  };
  await insertEvent(students[0], "TASK_STARTED", "开始任务：下垫面方案比较", "下垫面方案比较", 110);
  await insertEvent(students[0], "SIMULATION_SUBMITTED", "提交任务：下垫面方案比较", "第 1 次提交", 80, "submission", String(s1));
  await insertEvent(students[0], "TEACHER_FEEDBACK_RECEIVED", "任务通过：教师已批阅", "结论正确，解释清楚。", 70, "submission", String(s1));
  await insertEvent(students[0], "KNOWLEDGE_COMPLETED", "完成任务：城市排水系统基础", "城市排水系统基础", 120);
  await insertEvent(students[0], "GUIDED_COMPLETED", "完成任务：排水体制引导探究", "排水体制引导探究", 90);
  await insertEvent(students[0], "PRACTICE_COMPLETED", "提交任务：设计重现期专项练习", "第 1 次提交", 50);
  await insertEvent(students[0], "TASK_COMPLETED", "完成任务：城市排水系统基础", "城市排水系统基础", 119);

  await insertEvent(students[1], "SIMULATION_SUBMITTED", "提交任务：下垫面方案比较", "第 1 次提交", 60, "submission", String(s2));
  await insertEvent(students[1], "TEACHER_FEEDBACK_RECEIVED", "教师反馈：需要修改", "结论对但解释不足……", 50, "submission", String(s2));
  await insertEvent(students[1], "PRACTICE_COMPLETED", "提交任务：设计重现期专项练习", "第 1 次提交", 45);
  await insertEvent(students[1], "TEACHER_FEEDBACK_RECEIVED", "教师反馈：需要修改", "第 1、2 题错误……", 40, "submission", String(p2));

  await insertEvent(students[2], "SIMULATION_SUBMITTED", "提交任务：下垫面方案比较", "第 1 次提交", 30, "submission", String(s3));
  await insertEvent(students[2], "TASK_COMPLETED", "完成任务：补充学习：雨水管网规划复习", "补充学习：雨水管网规划复习", 5);
  await insertEvent(students[2], "PRACTICE_COMPLETED", "提交任务：设计重现期专项练习", "第 1 次提交", 20);

  await insertEvent(students[3], "KNOWLEDGE_COMPLETED", "完成任务：城市排水系统基础", "城市排水系统基础", 100);
  await insertEvent(students[3], "GUIDED_COMPLETED", "完成任务：排水体制引导探究", "排水体制引导探究", 72);
  await insertEvent(students[4], "SIMULATION_SUBMITTED", "提交任务：下垫面方案比较", "第 1 次提交", 10, "submission", String(s4));
  await insertEvent(students[5], "TASK_STARTED", "开始任务：下垫面方案比较", "下垫面方案比较", 26);

  // 232 班学习事件
  await insertEvent(students[8], "KNOWLEDGE_COMPLETED", "完成任务：雨水管网规划基础", "雨水管网规划基础", 72);
  await insertEvent(students[8], "SIMULATION_SUBMITTED", "提交任务：重现期情景对比", "第 1 次提交", 40, "submission", String(s5));
  await insertEvent(students[8], "PRACTICE_COMPLETED", "提交任务：汇流计算小练习", "第 1 次提交", 30);
  await insertEvent(students[8], "TASK_COMPLETED", "完成任务：汇流计算小练习", "汇流计算小练习", 29);
  await insertEvent(students[9], "TASK_STARTED", "开始任务：重现期情景对比", "重现期情景对比", 30);
  await insertEvent(students[9], "SIMULATION_SUBMITTED", "提交任务：重现期情景对比", "第 1 次提交", 25, "submission", String(s6));
  await insertEvent(students[9], "TEACHER_FEEDBACK_RECEIVED", "教师反馈：需要修改", "结论太简略……", 20, "submission", String(s6));
  await insertEvent(students[9], "TEACHER_FEEDBACK_RECEIVED", "教师反馈：需要修改", "第 1 题错误……", 12, "submission", String(p4));
  await insertEvent(students[10], "TASK_STARTED", "开始任务：重现期情景对比", "重现期情景对比", 6);

  // ── 8. 错题数据（quiz_results，含选项与解析，演示数据） ──
  const insertQuiz = async (email, question, correct, studentAns, topic, isCorrect, hoursAgoVal, options = [], explanation = "") => {
    await pool.query(
      "INSERT INTO quiz_results (user_email, question, correct_answer, student_answer, is_correct, topic, options, explanation, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [email, question, correct, studentAns, isCorrect, topic, JSON.stringify(options), explanation, hoursAgo(hoursAgoVal)],
    );
  };
  const topicA = "排水系统组成";
  const topicB = "设计流量";
  const topicC = "雨水量计算";
  await insertQuiz(students[2], "合流制管渠溢流的主要影响是？", "造成受纳水体污染", "增加管道输送能力", topicA, false, 26,
    ["增加管道输送能力", "造成受纳水体污染", "减少污水处理量", "提高管网坡度"], "合流制雨天超量混合污水经溢流口直排，造成受纳水体污染。");
  await insertQuiz(students[2], "雨水管渠设计流量按什么计算？", "设计暴雨强度公式", "年平均降雨量", topicB, false, 24,
    ["年平均降雨量", "设计暴雨强度公式", "管渠粗糙系数", "汇水区绿化率"], "设计流量按设计暴雨强度公式与径流系数计算。");
  await insertQuiz(students[6], "重现期为 2 年的一小时降雨量通常比 50 年一遇的（　）", "小", "大", topicC, false, 20,
    ["大", "小", "相等", "无法比较"], "重现期越长，设计暴雨强度越大。");
  await insertQuiz(students[6], "LID 设施的核心目标是？", "源头削减径流", "增大管径", topicC, false, 8,
    ["增大管径", "源头削减径流", "提高污水浓度", "增加泵站扬程"], "LID 通过源头控制削减径流。");
  await insertQuiz(students[2], "雨水口的主要作用是？", "汇集地面径流", "汇集地面径流", topicB, true, 6,
    ["输送雨水", "汇集地面径流", "净化水质", "蓄存雨水"], "雨水口收集地面径流进入管渠。");
  await insertQuiz(students[0], "设计暴雨重现期越大，暴雨强度（　）", "越大", "越大", topicC, true, 30,
    ["越大", "越小", "不变", "无法确定"], "重现期与设计暴雨强度正相关。");
  await insertQuiz(students[1], "绿色屋顶属于哪类措施？", "源头削减", "源头削减", topicC, true, 12,
    ["末端处理", "源头削减", "管道扩容", "泵站调蓄"], "绿色屋顶属于源头控制（LID）措施。");
  await insertQuiz(students[9], "径流系数反映的是？", "降雨转化为径流的比例", "管道粗糙程度", topicB, false, 14,
    ["管道粗糙程度", "降雨转化为径流的比例", "管渠坡度", "降雨历时"], "径流系数为径流量与降雨量之比。");
  await insertQuiz(students[9], "汇水区按什么划分？", "地形分水线", "道路中线", topicB, false, 10,
    ["道路中线", "地形分水线", "行政区划", "管径大小"], "汇水区按地形分水线就近划分。");
  await insertQuiz(students[10], "重现期提高意味着？", "设计暴雨更强", "管径变小", topicC, false, 7,
    ["管径变小", "设计暴雨更强", "造价降低", "汇流更快"], "重现期提高对应更强的设计暴雨。");
  await insertQuiz(students[8], "雨水口的作用是？", "汇集地面径流", "汇集地面径流", topicB, true, 18,
    ["汇集地面径流", "输送污水", "蓄存雨水", "净化水质"], "雨水口汇集地面径流。");
  await insertQuiz(students[11], "LID 设施属于哪类控制？", "源头控制", "源头控制", topicC, true, 16,
    ["源头控制", "末端控制", "中途控制", "泵站控制"], "LID 属于源头控制。");

  // ── 8.5 问答记录（learning_records，固定演示数据；时间早于该生最新小测以保持"5 问触发小测"节奏） ──
  const DEMO_QUESTIONS = [
    "城市内涝的主要成因是什么？", "海绵城市有哪些核心技术？", "暴雨强度公式中各参数的含义？",
    "SWMM模型如何用于内涝模拟？", "合流制与分流制有什么区别？", "雨水管渠设计流量的计算步骤？",
    "LID设施对径流削减有什么作用？", "排水系统的组成包括哪些部分？", "重现期与设计暴雨强度的关系？",
    "透水铺装的适用条件是什么？", "径流系数的含义与取值？", "植草沟的布置要点有哪些？",
  ];
  const recordSchedules = [
    { email: students[0], hours: [80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40, 36] },
    { email: students[1], hours: [60, 54, 48, 42, 36, 12] },
    { email: students[2], hours: [72, 66, 60, 54, 48, 32] },
    { email: students[3], hours: [50, 44, 38, 30] },
    { email: students[4], hours: [40, 34, 28] },
    { email: students[5], hours: [70, 62, 54, 44, 26] },
    { email: students[6], hours: [46, 38, 30] },
    { email: students[7], hours: [60, 50, 40, 24] },
    { email: students[8], hours: [50, 40, 30, 20] },
    { email: students[9], hours: [40, 30, 20] },
    { email: students[10], hours: [48, 36, 22] },
    { email: students[11], hours: [28, 18] },
  ];
  const topicNames = [DEMO_NODE_NAMES[5], DEMO_NODE_NAMES[6], DEMO_NODE_NAMES[8], DEMO_NODE_NAMES[9]];
  for (const schedule of recordSchedules) {
    for (let i = 0; i < schedule.hours.length; i++) {
      const q = DEMO_QUESTIONS[i % DEMO_QUESTIONS.length];
      await pool.query(
        `INSERT INTO learning_records (user_email, question, answer_summary, keywords, topics, has_references, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [schedule.email, q, `关于「${q}」的问答学习记录（演示数据）`, [topicNames[i % topicNames.length]],
         [topicNames[i % topicNames.length], topicNames[(i + 1) % topicNames.length]], i % 2 === 0, hoursAgo(schedule.hours[i])],
      );
    }
  }

  // ── 8.6 知识点掌握进度（student_node_progress，固定演示数据；node id 与课程图谱一致） ──
  const progressSchedules = [
    { email: students[0], mastery: [92, 90, 88, 85, 83, 80, 78, 75, 72, 70, 68] },
    { email: students[1], mastery: [85, 80, 75, 70, 66, 60, 55, 48] },
    { email: students[2], mastery: [78, 72, 68, 62, 58, 52, 45, 40] },
    { email: students[3], mastery: [70, 66, 60, 55, 48, 42] },
    { email: students[4], mastery: [65, 60, 55, 50, 44, 38] },
    { email: students[5], mastery: [55, 48, 40, 32] },
    { email: students[6], mastery: [40, 35, 30] },
  ];
  for (const s of progressSchedules) {
    for (let i = 0; i < s.mastery.length; i++) {
      const node = demoNodes[i];
      if (!node) continue;
      const mastery = s.mastery[i];
      const quizTotal = 6;
      const quizCorrect = Math.round((mastery / 100) * quizTotal);
      await pool.query(
        `INSERT INTO student_node_progress (user_email, node_id, question_count, study_count, quiz_correct, quiz_total, last_studied_at, mastery)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [s.email, node.id, 5 + i, 3 + (i % 3), quizCorrect, quizTotal, hoursAgo(4 + i * 9), mastery],
      );
    }
  }

  // ── 9. AI 问答存档 + 一条待审核反馈 ──
  const qa1 = (await pool.query(
    `INSERT INTO ai_qa_messages (user_email, question, answer, references_data, created_at)
     VALUES ($1,$2,$3,'[]',$4) RETURNING id`,
    [students[0], "海绵城市有哪些核心技术？",
      "海绵城市的核心技术包括：绿色屋顶、透水铺装、生物滞留设施、雨水花园、植草沟、雨水调蓄池等 LID 设施，通过“渗、滞、蓄、净、用、排”六字方针实现径流源头削减与雨洪管理。",
      hoursAgo(30)],
  )).rows[0].id;
  const qa2 = (await pool.query(
    `INSERT INTO ai_qa_messages (user_email, question, answer, references_data, created_at)
     VALUES ($1,$2,$3,'[]',$4) RETURNING id`,
    [students[2], "暴雨强度公式中 q 的单位是什么？",
      "暴雨强度公式中 q 通常表示设计暴雨强度，单位是 L/(s·hm²)（升每秒每公顷）。",
      hoursAgo(22)],
  )).rows[0].id;
  const qa3 = (await pool.query(
    `INSERT INTO ai_qa_messages (user_email, question, answer, references_data, created_at)
     VALUES ($1,$2,$3,'[]',$4) RETURNING id`,
    [students[2], "SWMM 中下渗模型 Horton 公式的参数含义？",
      "Horton 公式中 f0 为初始下渗率，fc 为稳定下渗率，k 为衰减系数，下渗率随时间从 f0 指数衰减到 fc。",
      hoursAgo(20)],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO ai_content_feedback (message_id, user_email, reason, note, status, created_at)
     VALUES ($1,$2,'内容错误',$3,'pending',$4)`,
    [qa3, students[2], "课本上 Horton 公式的衰减系数记作 kh，这里写成了 k。", hoursAgo(18)],
  );

  // 232 班 AI 问答存档 + 一条待审核反馈
  const qa4 = (await pool.query(
    `INSERT INTO ai_qa_messages (user_email, question, answer, references_data, created_at)
     VALUES ($1,$2,$3,'[]',$4) RETURNING id`,
    [students[9], "径流系数和径流量的关系是什么？",
      "径流量 = 径流系数 × 降雨量 × 汇水面积。径流系数反映降雨转化为径流的比例，透水面越多径流系数越低。",
      hoursAgo(13)],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO ai_content_feedback (message_id, user_email, reason, note, status, created_at)
     VALUES ($1,$2,'解释不清',$3,'pending',$4)`,
    [qa4, students[9], "公式看懂了，但不知道各变量单位怎么统一。", hoursAgo(11)],
  );
  await pool.query(
    `INSERT INTO ai_qa_messages (user_email, question, answer, references_data, created_at)
     VALUES ($1,$2,$3,'[]',$4)`,
    [students[8], "合流制溢流（CSO）是怎么产生的？",
      "雨天合流制管网中雨水混入污水使流量超过截流倍数，超量混合污水经溢流口直排受纳水体，造成 CSO 污染。",
      hoursAgo(17)],
  );
  await pool.query(
    `INSERT INTO ai_qa_messages (user_email, question, answer, references_data, created_at)
     VALUES ($1,$2,$3,'[]',$4)`,
    [students[4], "透水铺装的适用条件是什么？",
      "透水铺装适用于人行道、停车场等荷载较小的区域，需保证路基渗透能力并定期维护防止堵塞。",
      hoursAgo(28)],
  );

  // ── 10. 汇总 ──
  const cnt = async (sql, params = []) => (await pool.query(sql, params)).rows[0].count;
  const pendingFeedback = await cnt("SELECT count(*)::int AS count FROM ai_content_feedback WHERE status = 'pending'");
  // ── 9.5 演示通知与收藏（固定演示数据） ──
  await pool.query("DELETE FROM notifications WHERE user_email = ANY($1)", [demoEmails]).catch(() => {});
  await pool.query("DELETE FROM favorites WHERE user_email = ANY($1)", [demoEmails]).catch(() => {});
  await pool.query(
    `INSERT INTO notifications (user_email, type, title, body, link, created_at) VALUES
     ($1,'REVISION_REQUIRED','任务需要修改：下垫面方案比较','教师评语：结论对但解释不足，请补充机理分析后重新提交','/tasks/2', now() - interval '5 hours'),
     ($1,'TEACHER_FEEDBACK','教师已批阅：城市排水系统基础','已通过，继续保持','/tasks/1', now() - interval '2 days'),
     ($2,'SUBMISSION_RECEIVED','学生提交：下垫面方案比较','student02@demo.edu.cn 第 1 版提交','/teacher/tasks/2', now() - interval '2 days')`,
    [students[1], teacher],
  ).catch(() => {});
  await pool.query(
    `INSERT INTO favorites (user_email, ref_type, ref_id, note, in_review) VALUES
     ($1,'qa_message','demo-fav-1','合流制与分流制对比',true),
     ($1,'node','demo-fav-2','设计流量公式待复习',true)`,
    [students[0]],
  ).catch(() => {});

  // ── 9.6 演示私信（student01 ↔ 教师，覆盖学生/教师两侧未读角标） ──
  await pool.query(
    `INSERT INTO direct_messages (student_email, teacher_email, sender_email, body, read_at, created_at) VALUES
     ($1,$2,$1,'老师，下垫面加 LID 后模拟的最大水深能降多少？',$3,$4),
     ($1,$2,$2,'建议你跑一组 60% 与 90% 不透水率对照，记录峰值流量差值再对比，同时关注积水消退时间的变化。',NULL,$5),
     ($1,$2,$1,'好的，我跑完把数据发给您。',NULL,$6)`,
    [students[0], teacher, hoursAgo(28), hoursAgo(30), hoursAgo(20), hoursAgo(2)],
  ).catch(() => {});
  await pool.query(
    `INSERT INTO notifications (user_email, type, title, body, link, created_at) VALUES
     ($1,'DIRECT_MSG','教师回复了您的私信','建议你跑一组 60% 与 90% 不透水率对照……','/messages/teacher%40demo.edu.cn', now() - interval '20 hours')`,
    [students[0]],
  ).catch(() => {});

  console.log("演示数据导入完成：");
  console.log(`  用户：1 教师 + ${students.length} 学生（密码 ${DEMO_PASSWORD}）`);
  console.log(`  班级：2（排水231班 ${class231.length} 人 / 排水232班 4 人）`);
  console.log(`  任务：${await cnt("SELECT count(*)::int AS count FROM tasks WHERE teacher_email = $1", [teacher])}`);
  console.log(`  提交：${await cnt("SELECT count(*)::int AS count FROM task_submissions")}`);
  console.log(`  学习事件：${await cnt("SELECT count(*)::int AS count FROM learning_events WHERE user_email = ANY($1)", [demoEmails])}`);
  console.log(`  错题记录：${await cnt("SELECT count(*)::int AS count FROM quiz_results WHERE user_email = ANY($1)", [demoEmails])}`);
  console.log(`  AI 问答存档：${await cnt("SELECT count(*)::int AS count FROM ai_qa_messages WHERE user_email = ANY($1)", [demoEmails])}（含 ${pendingFeedback} 条待审核反馈）`);
  console.log(`  私信：${await cnt("SELECT count(*)::int AS count FROM direct_messages WHERE student_email = ANY($1) OR teacher_email = ANY($1)", [demoEmails])}`);
  console.log(`知识点关联：${demoNodes.length > 0 ? `使用课程图谱排水网络节点（如 ${demoNodes[0].name}）` : "节点目录缺失，任务未关联知识点"}`);
  console.log(`\n教师登录：${teacher} / ${DEMO_PASSWORD}`);
  console.log(`学生登录：student01@demo.edu.cn / ${DEMO_PASSWORD}（01-12 均可）`);
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    pool.end();
  });
