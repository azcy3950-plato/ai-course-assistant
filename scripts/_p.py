# 第四轮收口：通知幂等 + 批阅幂等 + 提交守卫
p = 'src/lib/learning-db.ts'
s = open(p, encoding='utf-8').read()

# 1) notifications 表加 dedupe_key + 部分唯一索引
old = """    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_email ON notifications(user_email, created_at DESC);"""
new = """    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
    CREATE INDEX IF NOT EXISTS idx_notifications_email ON notifications(user_email, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(user_email, type, dedupe_key) WHERE dedupe_key IS NOT NULL;"""
assert old in s
s = s.replace(old, new, 1)

# 2) addNotification 支持 dedupeKey（ON CONFLICT DO NOTHING）
old = '''export async function addNotification(input: {
  userEmail: string; type: string; title: string; body?: string; link?: string;
}) {
  await pool.query(
    "INSERT INTO notifications (user_email, type, title, body, link) VALUES ($1,$2,$3,$4,$5)",
    [input.userEmail, input.type, input.title, input.body || "", input.link || ""],
  );
}'''
new = '''export async function addNotification(input: {
  userEmail: string; type: string; title: string; body?: string; link?: string; dedupeKey?: string;
}) {
  await pool.query(
    `INSERT INTO notifications (user_email, type, title, body, link, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_email, type, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [input.userEmail, input.type, input.title, input.body || "", input.link || "", input.dedupeKey || null],
  );
}'''
assert old in s
s = s.replace(old, new, 1)

# 3) lazyDueSoonNotifications 用 dedupeKey（保留 NOT EXISTS 双保险）
old = '''    await addNotification({
      userEmail: email, type: "TASK_DUE_SOON",
      title: `任务即将截止：${r.title}`,'''
new = '''    await addNotification({
      userEmail: email, type: "TASK_DUE_SOON", dedupeKey: `TASK_DUE_SOON:${r.task_id}:${email}`,
      title: `任务即将截止：${r.title}`,'''
assert old in s
s = s.replace(old, new, 1)

# 4) addTeacherFeedback 幂等：同 submission 同 status 已批过 → 返回已有
old = '''export async function addTeacherFeedback(submissionId: number, teacherEmail: string, content: string, status: "passed" | "revision_required") {
  const sub = await pool.query("SELECT * FROM task_submissions WHERE id = $1", [submissionId]);
  const submission = sub.rows[0];
  if (!submission) return null;
  const task = await getTask(submission.task_id);
  if (!task || task.teacher_email !== teacherEmail) return { error: "无权批阅该提交" };'''
new = '''export async function addTeacherFeedback(submissionId: number, teacherEmail: string, content: string, status: "passed" | "revision_required") {
  const sub = await pool.query("SELECT * FROM task_submissions WHERE id = $1", [submissionId]);
  const submission = sub.rows[0];
  if (!submission) return null;
  const task = await getTask(submission.task_id);
  if (!task || task.teacher_email !== teacherEmail) return { error: "无权批阅该提交" };

  // 幂等：同一提交已存在同状态批阅（双击/重试）→ 直接返回已有，不重复插行/发通知/记事件
  const existing = await pool.query(
    "SELECT * FROM teacher_feedback WHERE submission_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1",
    [submissionId, status],
  );
  if (existing.rows[0]) {
    return { feedback: existing.rows[0], submission, duplicated: true };
  }'''
assert old in s
s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
print('learning-db ok')

# 5) 触发点 dedupeKey
p = 'src/app/api/tasks/route.ts'
s = open(p, encoding='utf-8').read()
old = '''      addNotification({
        userEmail: em,
        type: notifyType,'''
new = '''      addNotification({
        userEmail: em,
        type: notifyType,
        dedupeKey: `${notifyType}:${task.id}:${em}`,'''
assert old in s
s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
print('tasks dedupe ok')

p = 'src/app/api/tasks/[id]/submissions/route.ts'
s = open(p, encoding='utf-8').read()
# 提交守卫：SUBMITTED（非 REVISION）拒绝双击
old = '''    if (auth.role === "teacher") return NextResponse.json({ error: "教师不能替学生提交" }, { status: 403 });
    const st = await getStudentTask(taskId, auth.email);
    if (!st) return NextResponse.json({ error: "你未被分配该任务" }, { status: 403 });'''
new = '''    if (auth.role === "teacher") return NextResponse.json({ error: "教师不能替学生提交" }, { status: 403 });
    const st = await getStudentTask(taskId, auth.email);
    if (!st) return NextResponse.json({ error: "你未被分配该任务" }, { status: 403 });
    // 防双击：已提交且未被要求修改时拒绝再次提交（避免假版本 v2）
    if (st.status === "SUBMITTED") {
      return NextResponse.json({ error: "已提交，等待教师批阅" }, { status: 400 });
    }'''
assert old in s
s = s.replace(old, new, 1)
old = '''    addNotification({
      userEmail: task.teacher_email,
      type: submission.version > 1 ? "RESUBMISSION_RECEIVED" : "SUBMISSION_RECEIVED",'''
new = '''    addNotification({
      userEmail: task.teacher_email,
      type: submission.version > 1 ? "RESUBMISSION_RECEIVED" : "SUBMISSION_RECEIVED",
      dedupeKey: `SUBMISSION:${submission.id}:${submission.version}`,'''
assert old in s
s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
print('submissions guard+dedupe ok')

p = 'src/app/api/submissions/[id]/feedback/route.ts'
s = open(p, encoding='utf-8').read()
old = '''    addNotification({
      userEmail: result.submission.user_email,
      type: notifType,'''
new = '''    addNotification({
      userEmail: result.submission.user_email,
      type: notifType,
      dedupeKey: `FEEDBACK:${result.submission.id}:${result.submission.version}`,'''
assert old in s
s = s.replace(old, new, 1)
# 重复批阅时不重复发事件
old2 = '''    await addLearningEvent({
      userEmail: result.submission.user_email,
      type: "TEACHER_FEEDBACK_RECEIVED",'''
new2 = '''    if (!(result as any).duplicated) await addLearningEvent({
      userEmail: result.submission.user_email,
      type: "TEACHER_FEEDBACK_RECEIVED",'''
assert old2 in s
s = s.replace(old2, new2, 1)
# 去重时不重复写日志
old3 = '    await logAudit({ operatorEmail: auth.email, action: "FEEDBACK_SUBMIT",'
new3 = '    if (!(result as any).duplicated) await logAudit({ operatorEmail: auth.email, action: "FEEDBACK_SUBMIT",'
assert old3 in s
s = s.replace(old3, new3, 1)
open(p, 'w', encoding='utf-8').write(s)
print('feedback dedupe ok')

p = 'src/app/api/ai-review/route.ts'
s = open(p, encoding='utf-8').read()
old = '''        addNotification({
          userEmail: row.user_email,
          type: "AI_ANSWER_REVISED",'''
new = '''        addNotification({
          userEmail: row.user_email,
          type: "AI_ANSWER_REVISED",
          dedupeKey: `AI_REVISED:${messageId}:${version.version}`,'''
assert old in s
s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
print('ai-review dedupe ok')

# 6) 通知下拉诚实文案
p = 'src/components/Navbar.tsx'
s = open(p, encoding='utf-8').read()
old = '''                {notifs.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-[var(--color-text-muted)]">暂无通知</p>
                ) : ('''
new = '''                {notifs.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-[var(--color-text-muted)]">暂无通知</p>
                ) : ('''
assert old in s
s = s.replace(old, new, 1)
old2 = '''                  ))
                )}
              </div>
            )}
          </div>'''
# 在通知下拉末尾加说明
anchor = '''                )}
              </div>
            )}
          </div>

          {/* User Info + Logout */}'''
assert anchor in s
s = s.replace(anchor, '''                )}
                <p className="px-4 py-2.5 text-[10px] text-[var(--color-text-muted)] border-t border-[var(--color-border)]">
                  截止提醒在您访问平台时检查生成；其他通知由任务、批阅等事件即时产生。
                </p>
              </div>
            )}
          </div>

          {/* User Info + Logout */}''', 1)
open(p, 'w', encoding='utf-8').write(s)
print('navbar copy ok')
