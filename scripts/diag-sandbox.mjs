// 沙盘诊断：默认只检查本地，远程地址需显式传入。
import { chromium } from "playwright";
import { mkdirSync } from "fs";

const OUT = "artifacts/sandbox-diag";
mkdirSync(OUT, { recursive: true });

async function main() {
  const url = process.argv[2] || "http://localhost:3000/sandbox";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const logs = [];
  page.on("console", (msg) => logs.push(`[console.${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));
  page.on("requestfailed", (req) => logs.push(`[requestfailed] ${req.method()} ${req.url()} ${req.failure()?.errorText || ""}`));
  page.on("response", (res) => {
    if (res.url().includes("zijing_inp")) logs.push(`[response] ${res.status()} ${res.url()} type=${res.headers()["content-type"] || "?"}`);
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(9000);

  // 页内 fetch 探测（与沙盘代码同源同路径）
  const probe = await page.evaluate(async () => {
    try {
      const r = await fetch("/zijing_inp.inp");
      const text = await r.text();
      return { status: r.status, type: r.headers.get("content-type"), length: text.length, head: text.slice(0, 120).replace(/\n/g, "\\n"), hasCoord: text.includes("[COORDINATES]"), hasPoly: text.includes("[Polygons]") };
    } catch (e) {
      return { error: String(e) };
    }
  });
  console.log("页内 fetch 探测:", JSON.stringify(probe));

  await page.screenshot({ path: `${OUT}/sandbox-current.png` });
  const fullText = await page.evaluate(() => document.body.innerText);
  console.log("canvas:", await page.evaluate(() => document.querySelectorAll("canvas").length));
  console.log("=== 页面全文 ===");
  console.log(fullText.slice(0, 1500));
  console.log("=== 日志 ===");
  console.log(logs.slice(0, 50).join("\n") || "(空)");
  await browser.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
