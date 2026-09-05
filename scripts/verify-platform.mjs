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
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await sleep(2500);
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
    const hasQuizLink = await page.evaluate(() => document.body.innerText.includes("阶段测验总览"));
    record("教师学情分析「阶段测验总览」入口", hasQuizLink);
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
    const qCount = await page.evaluate(() => {
      const m = document.body.innerText.match(/问答次数\s*(\d+)次/);
      return m ? Number(m[1]) : -1;
    });
    record("学生首页问答次数>0", qCount > 0, `${qCount} 次`);

    // ── 3. 知识问答持久化（P0 修复验证）──
    const token = await tokenOf(page);
    const before = await apiCount(page, token, "/api/qa-messages");
    const beforeRecords = await apiCount(page, token, "/api/records");
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
    const nameInput = page.locator('input').first();
    await nameInput.fill("学生01测");
    await page.click('button:has-text("保存")');
    await sleep(1500);
    const navName = await page.evaluate(() => document.body.innerText.includes("学生01测"));
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

  await browser.close();
  console.log(`\n结果：${results.length - failed}/${results.length} 通过${failed ? `，${failed} 失败` : ""}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error("执行异常:", e.message);
  process.exitCode = 1;
});
