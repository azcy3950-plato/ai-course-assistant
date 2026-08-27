/**
 * 演示数据 seed 脚本（在部署服务器上运行）：
 *   node --env-file=.env.local scripts/seed-demo.mjs
 *
 * 创建固定的匿名演示账号、班级、学习任务、提交/批阅、学习事件、
 * 错题与 AI 问答存档，均为可复现的演示数据（不使用随机数）。
 * 登录信息（演示）：
 *   教师：teacher@demo.edu.cn / Demo123456
 *   学生：student01..12@demo.edu.cn / Demo123456
 */
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

  // ── 1. 用户 ──
  const pwHash = await hash(DEMO_PASSWORD, 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = EXCLUDED.role`,
    [teacher, pwHash, "张老师", "teacher"],
  );
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

  // ── 3. 真实知识图谱节点（用于任务关联与错题主题） ──
  const nodeRes = await pool.query("SELECT id, name FROM knowledge_graph_nodes ORDER BY sort_order NULLS LAST LIMIT 40");
  const nodes = nodeRes.rows;
  const pick = (n) => nodes.slice(0, Math.min(n, nodes.length)).map((x) => x.id);
  const nodeName = (id) => nodes.find((x) => x.id === id)?.name || id;

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

  // ── 8. 错题数据（quiz_results） ──
  const insertQuiz = async (email, question, correct, studentAns, topic, isCorrect, hoursAgoVal) => {
    await pool.query(
      "INSERT INTO quiz_results (user_email, question, correct_answer, student_answer, is_correct, topic, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [email, question, correct, studentAns, isCorrect, topic, hoursAgo(hoursAgoVal)],
    );
  };
  const topicA = nodes[0]?.name || "排水系统设计";
  const topicB = nodes[1]?.name || "雨水管网规划";
  const topicC = nodes[2]?.name || "暴雨强度计算";
  await insertQuiz(students[2], "合流制管渠溢流的主要影响是？", "造成受纳水体污染", "增加管道输送能力", topicA, false, 26);
  await insertQuiz(students[2], "雨水管渠设计流量按什么计算？", "设计暴雨强度公式", "年平均降雨量", topicB, false, 24);
  await insertQuiz(students[6], "重现期为 2 年的一小时降雨量通常比 50 年一遇的（　）", "小", "大", topicC, false, 20);
  await insertQuiz(students[6], "LID 设施的核心目标是？", "源头削减径流", "增大管径", topicC, false, 8);
  await insertQuiz(students[2], "雨水口的主要作用是？", "汇集地面径流", "汇集地面径流", topicB, true, 6);
  await insertQuiz(students[0], "设计暴雨重现期越大，暴雨强度（　）", "越大", "越大", topicC, true, 30);
  await insertQuiz(students[1], "绿色屋顶属于哪类措施？", "源头削减", "源头削减", topicC, true, 12);

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

  // ── 10. 汇总 ──
  const cnt = async (sql, params = []) => (await pool.query(sql, params)).rows[0].count;
  console.log("演示数据导入完成：");
  console.log(`  用户：1 教师 + ${students.length} 学生（密码 ${DEMO_PASSWORD}）`);
  console.log(`  班级：2（排水231班 ${class231.length} 人 / 排水232班 4 人）`);
  console.log(`  任务：${await cnt("SELECT count(*)::int AS count FROM tasks WHERE teacher_email = $1", [teacher])}`);
  console.log(`  提交：${await cnt("SELECT count(*)::int AS count FROM task_submissions")}`);
  console.log(`  学习事件：${await cnt("SELECT count(*)::int AS count FROM learning_events WHERE user_email = ANY($1)", [demoEmails])}`);
  console.log(`  错题记录：${await cnt("SELECT count(*)::int AS count FROM quiz_results WHERE user_email = ANY($1)", [demoEmails])}`);
  console.log(`  AI 问答存档：${await cnt("SELECT count(*)::int AS count FROM ai_qa_messages WHERE user_email = ANY($1)", [demoEmails])}（含 1 条待审核反馈）`);
  console.log(`知识点关联：${nodes.length > 0 ? `使用真实图谱节点（如 ${nodes[0].name}）` : "知识图谱暂无节点，任务未关联知识点"}`);
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
