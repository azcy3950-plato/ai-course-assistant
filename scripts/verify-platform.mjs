/**
 * 教师端/学生端全流程 E2E 验收（Playwright，在部署服务器或本地运行）：
 *   BASE_URL=http://127.0.0.1:3000 node --env-file=.env.local scripts/verify-platform.mjs
 * 覆盖：教师学情分析/抽检入口、学生首页数据、知识问答持久化（P0 修复）、
 *       标记完成必填收获、错题重新作答、profile 改名同步。
 * 每步打印 ✅/❌；结束后重置演示账号姓名。
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://117.72.97.219";
const results = [];
let failed = 0;

function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page, email, password) {
  // 本地到 VPS 链路有间歇抖动：登录请求偶发失败时不校验就继续会导致整块用例 401。
  // 登录后校验 localStorage 令牌，失败重试最多 3 次。
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
    // 清掉同一 context 其他页面留下的会话：否则登录页检测到已登录会自动跳首页，登录动作落空
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await sleep(2500);
    const tok = await page.evaluate(() => localStorage.getItem("aicourse-token") || "");
    if (tok) return;
  }
}

async function tokenOf(page) {
  return page.evaluate(() => localStorage.getItem("aicourse-token") || "");
}

async function apiCount(page, token, path) {
  const res = await page.evaluate(async ([p, t]) => {
    const r = await fetch(p, { headers: { Authorization: "Bearer " + t } });
    if (!r.ok) return -1;
    const d = await r.json();
    return Array.isArray(d) ? d.length : -1;
  }, [path, token]);
  return res;
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ── 1. 教师：学情分析按知识点 + 阶段测验总览入口 ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "teacher@demo.edu.cn", "Demo123456");
    await page.goto(BASE + "/teacher", { waitUntil: "domcontentloaded" });
    await sleep(2500);
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("学情"));
      if (btn) btn.click();
    });
    await sleep(2500);
    const hasQuizLink = await page.evaluate(() => document.body.innerText.includes("阶段测验总览"));
    record("教师学情分析「阶段测验总览」入口", hasQuizLink);
    // 新默认「仅真实学生」：演示教师无真实学生 → 0 个知识点
    const realNodeCount = await page.evaluate(() => {
      const m = document.body.innerText.match(/(\d+) 个知识点有学习数据/);
      return m ? Number(m[1]) : 0;
    });
    record("学情分析默认剔除演示账号（0 知识点）", realNodeCount === 0, `${realNodeCount} 个知识点`);
    // 切到「含演示账号」后应有数据
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("含演示账号"));
      if (btn) btn.click();
    });
    await sleep(2500);
    // 按知识点行数（取「个知识点有学习数据」前的数字）
    const nodeCount = await page.evaluate(() => {
      const m = document.body.innerText.match(/(\d+) 个知识点有学习数据/);
      return m ? Number(m[1]) : 0;
    });
    record("教师学情分析按知识点有数据", nodeCount > 0, `${nodeCount} 个知识点`);
    await page.close();
  }

  // ── 2. 学生01 首页数据 ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "student01@demo.edu.cn", "Demo123456");
    await sleep(2500);
    const text = await page.evaluate(() => document.body.innerText);
    record("学生首页待办任务区块", text.includes("待办任务"));
    record("学生首页最新教师反馈区块", text.includes("最新教师反馈"));
    // ── 3. 知识问答持久化（P0 修复验证）──
    const token = await tokenOf(page);
    const before = await apiCount(page, token, "/api/qa-messages");
    const beforeRecords = await apiCount(page, token, "/api/records");
    record("学生首页问答次数>0", beforeRecords > 0, `${beforeRecords} 次`);
    await page.goto(BASE + "/knowledge", { waitUntil: "domcontentloaded" });
    await sleep(2500);
    await page.fill('textarea, input[type="text"]', "什么是合流制？");
    await page.keyboard.press("Enter");
    await sleep(25000); // 等 DeepSeek 流式回答完成
    const after = await apiCount(page, token, "/api/qa-messages");
    const afterRecords = await apiCount(page, token, "/api/records");
    record("提问后 ai_qa_messages 新增", after > before, `${before}→${after}`);
    record("提问后 learning_records 新增", afterRecords > beforeRecords, `${beforeRecords}→${afterRecords}`);

    // ── 6. profile 改名同步导航栏 ──
    await page.goto(BASE + "/profile", { waitUntil: "domcontentloaded" });
    await sleep(2000);
    // 第一个 input 是 Navbar 搜索框，必须按 placeholder 定位姓名输入框
    const nameInput = page.locator('input[placeholder="姓名"]');
    await nameInput.fill("学生01测");
    await page.click('button:has-text("保存")');
    // 轮询等待 PATCH 完成并写入 localStorage（跨网延迟下固定 sleep 会误报）
    let navName = false;
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      navName = await page.evaluate(() => {
        try {
          const u = JSON.parse(localStorage.getItem("aicourse-user") || "{}");
          return u.name === "学生01测";
        } catch { return false; }
      });
      if (navName) break;
    }
    record("改名后导航栏立即刷新", navName);
    await nameInput.fill("学生01");
    await page.click('button:has-text("保存")');
    await sleep(1200);
    await page.close();
  }

  // ── 4. 学生07 标记完成必填收获 → 教师可见 ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "student07@demo.edu.cn", "Demo123456");
    await page.goto(BASE + "/tasks", { waitUntil: "domcontentloaded" });
    await sleep(2500);
    // 找到未完成的知识任务卡
    const taskHref = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[href*='/tasks/']"));
      const text = document.body.innerText;
      // 简单方式：直接打开第一个含「知识学习」且状态非已完成的卡
      const cards = Array.from(document.querySelectorAll("div")).filter((d) => d.textContent?.includes("知识学习") && d.textContent?.includes("未开始"));
      return null;
    });
    // 回退：用 API 找任务 id
    const token = await tokenOf(page);
    const taskId = await page.evaluate(async (t) => {
      const r = await fetch("/api/tasks", { headers: { Authorization: "Bearer " + t } });
      const d = await r.json();
      const task = d.find((x) => x.type === "KNOWLEDGE" && ["TODO", "IN_PROGRESS"].includes(x.effective_status));
      return task ? task.id : 0;
    }, token);
    record("student07 存在未完成知识任务", taskId > 0, `task=${taskId}`);
    if (taskId > 0) {
      await page.goto(`${BASE}/tasks/${taskId}`, { waitUntil: "domcontentloaded" });
      await sleep(2500);
      await page.click('button:has-text("标记完成")');
      await sleep(800);
      const modalVisible = await page.evaluate(() => document.body.innerText.includes("写下你本次学习的收获"));
      record("标记完成弹窗出现", modalVisible);
      await page.fill("textarea", "理解了排水体制的选择逻辑，合流制改造需要截流措施");
      await page.click('button:has-text("确认完成")');
      await sleep(2500);
      // 教师视角验证
      const tpage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await login(tpage, "teacher@demo.edu.cn", "Demo123456");
      await tpage.goto(`${BASE}/teacher/tasks/${taskId}`, { waitUntil: "domcontentloaded" });
      await sleep(2500);
      // 展开 student07 的行
      await tpage.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent?.includes("学生07"));
        if (rows.length) rows[0].click();
      });
      await sleep(1500);
      const sawNote = await tpage.evaluate(() => document.body.innerText.includes("学生自评"));
      record("教师任务详情看到学生自评", sawNote);
      await tpage.close();
    }
    await page.close();
  }

  // ── 5. 学生03 错题重新作答 ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "student03@demo.edu.cn", "Demo123456");
    await page.goto(BASE + "/history", { waitUntil: "domcontentloaded" });
    await sleep(2500);
    await page.click('button:has-text("我的错题")');
    await sleep(1500);
    const text1 = await page.evaluate(() => document.body.innerText);
    const beforeWrong = (text1.match(/共 (\d+) 次错误/g) || []).length;
    const hasRetry = text1.includes("重新作答");
    record("错题本有「重新作答」", hasRetry);
    await page.click('button:has-text("重新作答")');
    await sleep(1000);
    // 选第一个选项并提交（第一题正确答案是选项 B「设计暴雨强度公式」位置不定——选含「设计暴雨」的选项）
    const picked = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll("label")).filter((l) => l.textContent?.includes("设计暴雨"));
      if (labels.length) { labels[0].click(); return true; }
      return false;
    });
    if (picked) {
      await page.click('button:has-text("提交答案")');
      await sleep(2500);
      const text2 = await page.evaluate(() => document.body.innerText);
      const afterWrong = (text2.match(/共 (\d+) 次错误/g) || []).length;
      record("错题重新作答后数量减少", afterWrong < beforeWrong, `${beforeWrong}→${afterWrong}`);
    } else {
      record("错题重新作答可选项存在", false);
    }
    await page.close();
  }

  // ── 第四轮收口用例 ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "student02@demo.edu.cn", "Demo123456");
    const token = await tokenOf(page);

    // 通知去重：连续两次 GET，截止提醒不翻倍
    const n1 = await apiCount(page, token, "/api/notifications");
    const c1 = await page.evaluate(async (t) => {
      const r = await fetch("/api/notifications", { headers: { Authorization: "Bearer " + t } });
      const d = await r.json();
      return d.items.filter((x) => x.type === "TASK_DUE_SOON").length;
    }, token);
    await sleep(1200);
    const c2 = await page.evaluate(async (t) => {
      const r = await fetch("/api/notifications", { headers: { Authorization: "Bearer " + t } });
      const d = await r.json();
      return d.items.filter((x) => x.type === "TASK_DUE_SOON").length;
    }, token);
    record("通知去重：连续 GET 截止提醒不翻倍", c1 === c2, `${c1}→${c2}`);

    // 小测过期 token → 400
    const quizRes = await page.evaluate(async (t) => {
      const r = await fetch("/api/quiz", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ token: "bogus-token", answers: [{ index: 0, studentAnswer: "A" }] }) });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, token);
    record("小测过期 token 返回 400 且提示重新生成", quizRes.status === 400 && /过期|重新生成/.test(quizRes.body.error || ""), `${quizRes.status} ${quizRes.body.error || ""}`);

    // 附件越权：学生 B 下载学生 A 的附件 key（不存在 key → 404；伪造 key 前缀 → 400）
    const attRes = await page.evaluate(async (t) => {
      const r = await fetch("/api/attachments?key=" + encodeURIComponent("task-attachments/9999999999999_fakefake_x.pdf"), { headers: { Authorization: "Bearer " + t } });
      return r.status;
    }, token);
    record("附件越权防护：非本人/非任务教师下载被拒(404/403)", attRes === 404 || attRes === 403, `HTTP ${attRes}`);
    await page.close();
  }

  // 批阅幂等：教师对同一提交连续两次 POST feedback → 第二次不重复插行
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "teacher@demo.edu.cn", "Demo123456");
    const token = await tokenOf(page);
    const sid = await page.evaluate(async (t) => {
      const list = await fetch("/api/tasks", { headers: { Authorization: "Bearer " + t } });
      const tasks = await list.json();
      const sim = tasks.find((x) => x.type === "SIMULATION");
      if (!sim) return 0;
      const r = await fetch(`/api/tasks/${sim.id}`, { headers: { Authorization: "Bearer " + t } });
      const d = await r.json();
      const pending = (d.submissions || []).find((x) => x.status === "pending");
      return pending ? pending.id : 0;
    }, token);
    record("存在待批提交", sid > 0, `submission=${sid}`);
    if (sid > 0) {
      const post = async () => {
        const r = await fetch(BASE + `/api/submissions/${sid}/feedback`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ content: "收口测试评语", status: "passed" }),
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
      };
      const first = await post();
      const second = await post();
      // 断言：第一次真实插入（duplicated=false），第二次命中幂等（duplicated=true），未产生重复行
      record("批阅幂等：同状态重复 POST 不产生第二条评语",
        first.status === 200 && first.body.duplicated === false && second.status === 200 && second.body.duplicated === true,
        `第一次 dup=${first.body.duplicated} 第二次 dup=${second.body.duplicated}`);
    }
    await page.close();
  }

  // ── 第五轮用例：师生私信闭环 ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "student01@demo.edu.cn", "Demo123456");
    const token = await tokenOf(page);
    const tag = "自动化验证" + Date.now();

    const unreadBefore = await page.evaluate(async (t) => {
      const r = await fetch("/api/messages/unread", { headers: { Authorization: "Bearer " + t } });
      return (await r.json()).count ?? -1;
    }, token);

    const sendRes = await page.evaluate(async ([t, body]) => {
      const r = await fetch("/api/messages", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
        body: JSON.stringify({ with: "teacher@demo.edu.cn", body }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, [token, tag + " 学生提问"]);
    record("学生发私信成功", sendRes.status === 200 && sendRes.body.message?.id > 0, `HTTP ${sendRes.status}`);

    // 越权：无 token → 401
    const noToken = await page.evaluate(async () => {
      const r = await fetch("/api/messages");
      return r.status;
    });
    record("私信无 token 返回 401", noToken === 401, `HTTP ${noToken}`);

    // ── 教师侧：收件箱可见 + 越权矩阵 + 回复 ──
    const tpage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(tpage, "teacher@demo.edu.cn", "Demo123456");
    const ttoken = await tokenOf(tpage);

    const inbox = await tpage.evaluate(async ([t, body]) => {
      const r = await fetch("/api/messages", { headers: { Authorization: "Bearer " + t } });
      const d = await r.json();
      const conv = (d.conversations || []).find((x) => x.peer_email === "student01@demo.edu.cn");
      return { status: r.status, found: !!conv, lastBody: conv?.last_body || "", unread: conv?.unread ?? -1 };
    }, [ttoken, tag]);
    record("教师收件箱可见学生新消息", inbox.status === 200 && inbox.found && inbox.lastBody.includes(tag), inbox.lastBody.slice(0, 30));

    const forbid = await tpage.evaluate(async (t) => {
      const r = await fetch("/api/messages?with=" + encodeURIComponent("student13@demo.edu.cn"), { headers: { Authorization: "Bearer " + t } });
      return r.status;
    }, ttoken);
    record("教师访问非本班学生被拒 403", forbid === 403, `HTTP ${forbid}`);

    const replyRes = await tpage.evaluate(async ([t, body]) => {
      const r = await fetch("/api/messages", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
        body: JSON.stringify({ with: "student01@demo.edu.cn", body }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, [ttoken, tag + " 教师回复"]);
    record("教师回复私信成功", replyRes.status === 200, `HTTP ${replyRes.status}`);

    // 教师仪表盘 payload 结构（默认「仅真实学生」→ 演示教师 0 人）
    const dash = await tpage.evaluate(async (t) => {
      const r = await fetch("/api/dashboard", { headers: { Authorization: "Bearer " + t } });
      const d = await r.json();
      return { status: r.status, classCount: d.stats?.classCount, studentCount: d.stats?.studentCount,
        trendLen: (d.trend || []).length, weakLen: (d.weakStudents || []).length, scope: d.scope, error: d.error || "" };
    }, ttoken);
    record("仪表盘默认剔除演示账号（0 人）", dash.status === 200 && dash.studentCount === 0 && dash.scope === "real", `${dash.scope} ${dash.studentCount} 人`);
    // 含演示账号 → 12 名学生 + 14 天趋势
    const dashAll = await tpage.evaluate(async (t) => {
      const r = await fetch("/api/dashboard?scope=all", { headers: { Authorization: "Bearer " + t } });
      const d = await r.json();
      return { status: r.status, classCount: d.stats?.classCount, studentCount: d.stats?.studentCount,
        trendLen: (d.trend || []).length, weakLen: (d.weakStudents || []).length, scope: d.scope, error: d.error || "" };
    }, ttoken);
    record("仪表盘 payload：班级≥2 学生=12", dashAll.status === 200 && dashAll.classCount >= 2 && dashAll.studentCount === 12, `${dashAll.classCount} 班 ${dashAll.studentCount} 人`);
    record("仪表盘 trend 恰 14 条", dashAll.trendLen === 14, `${dashAll.trendLen} 条`);
    record("仪表盘薄弱学生 ≤5", dashAll.weakLen <= 5, `${dashAll.weakLen} 人`);

    // ── 学生侧：未读增加 → 打开会话归零 → 对方消息已读 ──
    const unreadAfter = await page.evaluate(async (t) => {
      const r = await fetch("/api/messages/unread", { headers: { Authorization: "Bearer " + t } });
      return (await r.json()).count ?? -1;
    }, token);
    record("学生未读增加", unreadAfter > unreadBefore, `${unreadBefore}→${unreadAfter}`);

    await page.goto(BASE + "/messages/teacher%40demo.edu.cn", { waitUntil: "domcontentloaded" });
    await sleep(3000);
    const unreadNow = await page.evaluate(async (t) => {
      const r = await fetch("/api/messages/unread", { headers: { Authorization: "Bearer " + t } });
      return (await r.json()).count ?? -1;
    }, token);
    record("打开会话页后未读归零", unreadNow === 0, `now=${unreadNow}`);

    const thread = await page.evaluate(async ([t, body]) => {
      const r = await fetch("/api/messages?with=" + encodeURIComponent("teacher@demo.edu.cn"), { headers: { Authorization: "Bearer " + t } });
      const d = await r.json();
      const reply = (d.messages || []).filter((m) => m.body.includes(body)).pop();
      return { count: (d.messages || []).length, replyRead: reply ? !!reply.read_at : null };
    }, [token, tag]);
    record("会话时间线含双方消息且教师回复已读", thread.count >= 2 && thread.replyRead === true, `${thread.count} 条`);

    await tpage.close();
    await page.close();
  }

  // ── 第五轮用例：admin 被拒 + 空数据教师空态 ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "admin@demo.edu.cn", "Demo123456");
    const token = await tokenOf(page);
    const adminRes = await page.evaluate(async (t) => {
      const r = await fetch("/api/messages", { headers: { Authorization: "Bearer " + t } });
      return r.status;
    }, token);
    record("admin 访问私信被拒 403", adminRes === 403, `HTTP ${adminRes}`);
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // 本地到 VPS 链路有间歇抖动：登录请求偶发失败会被 /teacher 守卫踢回登录页，
    // 检测到登录页特征就重新登录重试（最多 3 轮），真正的空态回归仍会如实失败。
    let text = "";
    let sawEmpty = false;
    for (let attempt = 0; attempt < 3 && !sawEmpty; attempt++) {
      await login(page, "teacherempty@demo.edu.cn", "Demo123456");
      await page.goto(BASE + "/teacher", { waitUntil: "domcontentloaded" });
      for (let i = 0; i < 12; i++) {
        await sleep(500);
        text = await page.evaluate(() => document.body.innerText);
        if (text.includes("暂无班级与学生")) { sawEmpty = true; break; }
        if (text.includes("忘记密码")) break; // 被踢回登录页 → 重登
      }
    }
    record("空数据教师仪表盘显示整页空态", sawEmpty, text.slice(0, 80).replace(/\s+/g, " "));
    await page.close();
  }

  // ── 修 bug 轮回归用例 ──
  {
    // 越权矩阵 + 修复项（教师侧）
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // 登录未生效（网络抖动）时整流程重试
    let res = {};
    for (let attempt = 0; attempt < 3 && (res.studentDetail === undefined || res.studentDetail === 401); attempt++) {
      await login(page, "teacher@demo.edu.cn", "Demo123456");
      const token = await tokenOf(page);
      res = await page.evaluate(async (t) => {
      const out = {};
      const s1 = await fetch("/api/students?email=" + encodeURIComponent("student13@demo.edu.cn"), { headers: { Authorization: "Bearer " + t } });
      out.studentDetail = s1.status;
      const s2 = await fetch("/api/students", { headers: { Authorization: "Bearer " + t } });
      const d2 = await s2.json();
      out.studentListLen = (d2.students || []).length;
      const s3 = await fetch("/api/admin/student", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ email: "student13@demo.edu.cn", password: "Hack12345" }) });
      out.adminStudentPut = s3.status;
      const s4 = await fetch("/api/admin/student?email=" + encodeURIComponent("student13@demo.edu.cn"), { method: "DELETE", headers: { Authorization: "Bearer " + t } });
      out.adminStudentDelete = s4.status;
      const s5 = await fetch("/api/quiz-results?scope=all", { headers: { Authorization: "Bearer " + t } });
      const d5 = await s5.json();
      const demoEmails = new Set(Array.from({ length: 12 }, (_, i) => `student${String(i + 1).padStart(2, "0")}@demo.edu.cn`));
      out.quizAllOwn = Array.isArray(d5) && d5.every((x) => demoEmails.has(x.user_email));
      const s6 = await fetch("/api/tasks/abc", { headers: { Authorization: "Bearer " + t } });
      out.nanId = s6.status;
      const s7 = await fetch("/api/documents-status", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ fileKey: "verify-doc-" + Date.now(), fileName: "验收文档.pdf", status: "UPLOADING" }) });
      out.docStatus = s7.status;
      return out;
      }, token);
    }
    record("越权：教师查非本班学生详情被拒 403", res.studentDetail === 403, `HTTP ${res.studentDetail}`);
    record("学生名册仅本班（12 人）", res.studentListLen === 12, `${res.studentListLen} 人`);
    record("越权：教师改非本班学生密码被拒 403", res.adminStudentPut === 403, `HTTP ${res.adminStudentPut}`);
    record("越权：教师删非本班学生被拒 403", res.adminStudentDelete === 403, `HTTP ${res.adminStudentDelete}`);
    record("小测结果仅本班学生", res.quizAllOwn === true, "");
    record("非法任务 id 返回 400", res.nanId === 400, `HTTP ${res.nanId}`);
    record("文档状态上报修复（此前必 500）", res.docStatus === 200, `HTTP ${res.docStatus}`);
    await page.close();
  }
  {
    // admin 仪表盘自洽（requireTeacher 放行 admin 后不再是"加载失败"）
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // 401 可能是登录未生效（网络抖动），整流程重试
    let dash = { status: 0, classCount: undefined };
    for (let attempt = 0; attempt < 3 && dash.status !== 200; attempt++) {
      await login(page, "admin@demo.edu.cn", "Demo123456");
      const token = await tokenOf(page);
      dash = await page.evaluate(async (t) => {
        const r = await fetch("/api/dashboard", { headers: { Authorization: "Bearer " + t } });
        const d = await r.json();
        return { status: r.status, classCount: (d.stats || {}).classCount };
      }, token);
    }
    record("admin 访问仪表盘 API 自洽（空数据 200）", dash.status === 200 && dash.classCount === 0, `HTTP ${dash.status} classCount=${dash.classCount}`);
    await page.close();
  }
  {
    // 学生侧数据与流程防线（student03：有 SUBMITTED 仿真任务）
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // 登录未生效（网络抖动）时整流程重试
    let res = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      await login(page, "student03@demo.edu.cn", "Demo123456");
      const token = await tokenOf(page);
      res = await page.evaluate(async (t) => {
        const out = {};
        const tr = await fetch("/api/tasks", { headers: { Authorization: "Bearer " + t } });
        const tasks = await tr.json();
        if (!Array.isArray(tasks)) { out.error = "tasks 非数组"; return out; }
        const practice = tasks.find((x) => x.type === "PRACTICE");
        out.practiceNoAnswer = practice ? (practice.questions || []).every((q) => !("answer" in q) && !("explanation" in q)) : null;
        const submitted = tasks.find((x) => x.effective_status === "SUBMITTED" && x.type !== "PRACTICE");
        if (submitted) {
          const dup = await fetch(`/api/tasks/${submitted.id}/submissions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ judgment: "x", explanation: "x" }) });
          out.dupSubmit = dup.status;
        }
        const ev = await fetch("/api/learning-events", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ type: "TASK_COMPLETED", title: "伪造", summary: "x" }) });
        out.fakeEvent = ev.status;
        return out;
      }, token);
      if (!res.error) break;
    }
    record("练习答案/解析对学生列表遮罩", res.practiceNoAnswer === true, String(res.practiceNoAnswer));
    record("已提交任务重复 POST 被拒 400", res.dupSubmit === 400, res.dupSubmit === undefined ? "无 SUBMITTED 任务" : `HTTP ${res.dupSubmit}`);
    record("伪造 TASK_COMPLETED 事件被拒 400", res.fakeEvent === 400, `HTTP ${res.fakeEvent}`);
    await page.close();
  }
  {
    // 学生侧防线（student04：练习任务 TODO，验证类型限定与缺参判分）
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // 登录未生效（网络抖动）时整流程重试
    let res = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      await login(page, "student04@demo.edu.cn", "Demo123456");
      const token = await tokenOf(page);
      res = await page.evaluate(async (t) => {
      const out = {};
      const tr = await fetch("/api/tasks", { headers: { Authorization: "Bearer " + t } });
      const tasks = await tr.json();
      if (!Array.isArray(tasks)) { out.error = "tasks 非数组"; return out; }
      const practice = tasks.find((x) => x.type === "PRACTICE");
      if (practice) {
        const comp = await fetch(`/api/tasks/${practice.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({ action: "complete", note: "直接完成" }) });
        out.practiceComplete = comp.status;
        const subNoAns = await fetch(`/api/tasks/${practice.id}/submissions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify({}) });
        out.subNoAns = subNoAns.status;
      }
      return out;
    }, token);
      if (!res.error) break;
    }
    record("PRACTICE 直接标完成被拒 400", res.practiceComplete === 400, `HTTP ${res.practiceComplete}`);
    record("PRACTICE 缺 answers 提交不再 500", res.subNoAns === 200, `HTTP ${res.subNoAns}`);
    await page.close();
  }
  {
    // 未登录访问 /knowledge 重定向登录页
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + "/knowledge", { waitUntil: "domcontentloaded" });
    await sleep(2500);
    const url = page.url();
    record("未登录访问知识问答重定向登录页", url.includes("/login"), url.slice(0, 60));
    await page.close();
  }

  // 移动视口冒烟
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(page, "student01@demo.edu.cn", "Demo123456");
    for (const path of ["/tasks", "/history", "/messages", "/messages/teacher%40demo.edu.cn"]) {
      await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
      await sleep(2500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5);
      record(`移动视口无横向溢出：${path}`, !overflow);
    }
    await page.close();

    const tpage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(tpage, "teacher@demo.edu.cn", "Demo123456");
    await tpage.goto(BASE + "/teacher", { waitUntil: "domcontentloaded" });
    await sleep(3500);
    const overflow = await tpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5);
    record("移动视口无横向溢出：/teacher(仪表盘)", !overflow);
    await tpage.close();
  }

  await browser.close();
  console.log(`\n结果：${results.length - failed}/${results.length} 通过${failed ? `，${failed} 失败` : ""}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error("执行异常:", e.message);
  process.exitCode = 1;
});
