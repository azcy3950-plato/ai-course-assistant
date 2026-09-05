# ── 1. login 拒绝 disabled 用户 ──
p = 'src/app/api/auth/login/route.ts'
s = open(p, encoding='utf-8').read()
old = """    const user = rows[0];
    const valid = await compare(password, user.password_hash);"""
new = """    const user = rows[0];
    if (user.status === "disabled") {
      return NextResponse.json({ error: "账号或密码错误" }, { status: 401 });
    }
    const valid = await compare(password, user.password_hash);"""
assert old in s
s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
print('login status check ok')

# ── 2. /me 拒绝 disabled ──
p = 'src/app/api/auth/me/route.ts'
s = open(p, encoding='utf-8').read()
old = """    if (rows.length === 0) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    const u = rows[0];"""
new = """    if (rows.length === 0) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    const u = rows[0];
    if ((u as any).status === "disabled") return NextResponse.json({ error: "账号已停用" }, { status: 403 });"""
assert old in s
s = s.replace(old, new, 1)
old2 = '"SELECT id, email, phone, name, role, avatar, token_version FROM users WHERE id = $1",'
new2 = '"SELECT id, email, phone, name, role, avatar, token_version, status FROM users WHERE id = $1",'
assert old2 in s
s = s.replace(old2, new2, 1)
open(p, 'w', encoding='utf-8').write(s)
print('me status check ok')

# ── 3. /api/admin/promote 改为 admin 专属（临时保留，教师端移除 tab 后即删） ──
p = 'src/app/api/admin/promote/route.ts'
s = open(p, encoding='utf-8').read()
if 'requireAdmin' not in s:
    s = s.replace('requireTeacher', 'requireAdmin', 1)
    open(p, 'w', encoding='utf-8').write(s)
    print('promote re-gated to admin')
else:
    print('promote already admin')

# ── 4. mkuser.js 支持 admin ──
p = 'mkuser.js'
s = open(p, encoding='utf-8').read()
old = 'const [email, password, name = "教师", role = "teacher"] = process.argv.slice(2);'
new = 'const [email, password, name = "教师", role = "teacher"] = process.argv.slice(2);\n  if (!["student", "teacher", "admin"].includes(role)) {\n    throw new Error("角色必须是 student / teacher / admin");\n  }'
assert old in s
s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
print('mkuser admin ok')

# ── 5. seed 加 admin 演示账号 + notifications/favorites 演示数据 ──
p = 'scripts/seed-demo.mjs'
s = open(p, encoding='utf-8').read()
old = """  await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = EXCLUDED.role`,
    [teacher, pwHash, "张老师", "teacher"],
  );"""
new = old + """
  await pool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = EXCLUDED.role`,
    ["admin@demo.edu.cn", pwHash, "管理员", "admin"],
  );
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'").catch(() => {});"""
assert old in s
s = s.replace(old, new, 1)

# 演示通知与收藏（固定演示数据）
old_summary = """  console.log("演示数据导入完成：");"""
new_block = """  // ── 9.5 演示通知与收藏（固定演示数据） ──
  await pool.query("DELETE FROM notifications WHERE user_email = ANY($1)", [demoEmails]);
  await pool.query("DELETE FROM favorites WHERE user_email = ANY($1)", [demoEmails]);
  await pool.query(
    `INSERT INTO notifications (user_email, type, title, body, link, created_at) VALUES
     ($1,'REVISION_REQUIRED','任务需要修改：下垫面方案比较','教师评语：结论对但解释不足，请补充机理分析后重新提交','/tasks/2', now() - interval '5 hours'),
     ($1,'TEACHER_FEEDBACK','教师已批阅：城市排水系统基础','已通过，继续保持','/tasks/1', now() - interval '2 days'),
     ($2,'SUBMISSION_RECEIVED','学生提交：下垫面方案比较','student02@demo.edu.cn 第 1 版提交','/teacher/tasks/2', now() - interval '2 days')`,
    [students[1], teacher],
  );
  await pool.query(
    `INSERT INTO favorites (user_email, ref_type, ref_id, note, in_review) VALUES
     ($1,'qa_message','demo-fav-1','含流制与分流制对比',true),
     ($1,'node','demo-fav-2','设计流量公式待复习',true)`,
    [students[0]],
  ).catch(() => {});

  console.log("演示数据导入完成：");"""
assert old_summary in s
s = s.replace(old_summary, new_block, 1)
open(p, 'w', encoding='utf-8').write(s)
print('seed extended')
