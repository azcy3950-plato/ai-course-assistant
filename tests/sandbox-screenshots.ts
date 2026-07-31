// Sandbox automated screenshot + verification script
import { chromium } from "playwright";
import * as path from "path";
import { mkdirSync } from "fs";

const BASE = "http://117.72.97.219/sandbox";
const OUT = path.resolve("artifacts/sandbox-final");
mkdirSync(OUT, { recursive: true });

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log("Opening sandbox...");
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(3000);

  // Verify basics
  const canvasCount = await page.evaluate(() => document.querySelectorAll("canvas").length);
  console.log(`Canvas count: ${canvasCount}`);

  const errors: string[] = [];
  page.on("pageerror", err => errors.push(err.message));

  // 01 static cutaway overview (default)
  console.log("01 static-cutaway-overview");
  await page.screenshot({ path: path.join(OUT, "01-static-cutaway-overview.png"), fullPage: false });
  await sleep(500);

  // 02 normal overview (toggle clipping off)
  console.log("02 static-normal-overview");
  const clipBtns = await page.$$("button");
  for (const btn of clipBtns) {
    const text = await btn.textContent();
    if (text?.includes("✂")) { await btn.click(); break; }
  }
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, "02-static-normal-overview.png"), fullPage: false });
  // Re-enable clipping
  for (const btn of clipBtns) {
    const text = await btn.textContent();
    if (text?.includes("✂")) { await btn.click(); break; }
  }
  await sleep(500);

  // 03 topdown
  console.log("03 static-top");
  // Find and click topdown button
  const allBtns = await page.$$("button");
  for (const btn of allBtns) {
    const title = await btn.getAttribute("title");
    if (title === "俯视") { await btn.click(); break; }
  }
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, "03-static-top.png"), fullPage: false });
  // Go back to panorama
  for (const btn of allBtns) {
    const title = await btn.getAttribute("title");
    if (title === "全景") { await btn.click(); break; }
  }
  await sleep(500);

  // 04 underground
  console.log("04 static-underground");
  for (const btn of allBtns) {
    const title = await btn.getAttribute("title");
    if (title === "地下") { await btn.click(); break; }
  }
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, "04-static-underground.png"), fullPage: false });
  for (const btn of allBtns) {
    const title = await btn.getAttribute("title");
    if (title === "全景") { await btn.click(); break; }
  }
  await sleep(500);

  // 05 pipe hover/select — click a pipe in scene
  console.log("05 static-pipe-selected");
  await page.mouse.click(700, 400); // center-ish area where pipes should be
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, "05-static-pipe-selected.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await sleep(300);

  // 06 node selected — click near center
  console.log("06 static-node-selected");
  await page.mouse.click(750, 420);
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, "06-static-node-selected.png"), fullPage: false });

  // 07 search J1
  console.log("07 static-search-j1");
  // Type into search input
  const searchInput = await page.$("input[placeholder*='搜索']");
  if (searchInput) {
    await searchInput.fill("J1");
    await sleep(500);
    // Click first result
    const results = await page.$$("div.cursor-pointer");
    if (results.length > 0) await results[0].click();
    await sleep(800);
  }
  await page.screenshot({ path: path.join(OUT, "07-static-search-j1.png"), fullPage: false });
  await page.keyboard.press("Escape");

  // 08 Switch to dynamic mode
  console.log("08 dynamic-config");
  for (const btn of allBtns) {
    const text = await btn.textContent();
    if (text?.includes("动态推演")) { await btn.click(); break; }
  }
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, "08-dynamic-config.png"), fullPage: false });

  // Find and click "开始推演"
  console.log("Starting simulation...");
  const dynBtns = await page.$$("button");
  for (const btn of dynBtns) {
    const text = await btn.textContent();
    if (text?.includes("开始推演")) { await btn.click(); break; }
  }
  // Wait for simulation to complete (can take ~15-30s)
  await sleep(30000);
  // Check if completed
  const doneText = await page.textContent("body");
  console.log("Simulation status:", doneText?.includes("就绪") ? "ready" : doneText?.includes("完成") ? "done" : "?");

  // Click "播放" if ready
  const readyBtns = await page.$$("button");
  for (const btn of readyBtns) {
    const text = await btn.textContent();
    if (text?.includes("播放")) { await btn.click(); break; }
  }
  await sleep(2000);

  // 09 step 0
  console.log("09 dynamic-step-0");
  await page.screenshot({ path: path.join(OUT, "09-dynamic-step-0.png"), fullPage: false });

  // 10 step 100 — drag timeline
  console.log("10 dynamic-step-100");
  const slider = await page.$("input[type='range']");
  if (slider) {
    const box = await slider.boundingBox();
    if (box) {
      const pct = 100 / 287;
      await page.mouse.click(box.x + box.width * pct, box.y + box.height / 2);
    }
  }
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, "10-dynamic-step-100.png"), fullPage: false });

  // 11 step 200
  console.log("11 dynamic-step-200");
  if (slider) {
    const box = await slider.boundingBox();
    if (box) {
      const pct = 200 / 287;
      await page.mouse.click(box.x + box.width * pct, box.y + box.height / 2);
    }
  }
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, "11-dynamic-step-200.png"), fullPage: false });

  // 12 step 286
  console.log("12 dynamic-step-286");
  if (slider) {
    const box = await slider.boundingBox();
    if (box) {
      const pct = 286 / 287;
      await page.mouse.click(box.x + box.width * pct, box.y + box.height / 2);
    }
  }
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, "12-dynamic-step-286.png"), fullPage: false });

  // 13 GD1 at forward flow — step 200 should have positive flow
  console.log("13 dynamic-gd1-forward");
  // Click near GD1 (search for it first)
  if (searchInput) {
    await searchInput.fill("GD1");
    await sleep(500);
    const results = await page.$$("div.cursor-pointer");
    if (results.length > 0) await results[0].click();
    await sleep(800);
  }
  await page.screenshot({ path: path.join(OUT, "13-dynamic-gd1-forward.png"), fullPage: false });

  // 14 GD1 at reverse flow — step 286 should have negative flow
  console.log("14 dynamic-gd1-reverse");
  if (slider) {
    const box = await slider.boundingBox();
    if (box) {
      const pct = 270 / 287; // late step where reverse flow occurs
      await page.mouse.click(box.x + box.width * pct, box.y + box.height / 2);
    }
  }
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, "14-dynamic-gd1-reverse.png"), fullPage: false });

  // 15 node water column — click a node during dynamic
  console.log("15 dynamic-node-water");
  await page.keyboard.press("Escape");
  await sleep(300);
  await page.mouse.click(720, 380);
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, "15-dynamic-node-water.png"), fullPage: false });

  // 16 ponding (if any)
  console.log("16 dynamic-ponding");
  await page.screenshot({ path: path.join(OUT, "16-dynamic-ponding.png"), fullPage: false });

  // 17-18 curves — click expand curves button
  console.log("17 dynamic-node-chart");
  const curveBtns = await page.$$("button");
  for (const btn of curveBtns) {
    const text = await btn.textContent();
    if (text?.includes("展开曲线")) { await btn.click(); break; }
  }
  await sleep(1000);
  await page.screenshot({ path: path.join(OUT, "17-dynamic-node-chart.png"), fullPage: false });

  // Switch pipe selection for pipe chart
  console.log("18 dynamic-pipe-chart");
  await page.keyboard.press("Escape");
  await sleep(300);
  if (searchInput) {
    await searchInput.fill("GD1");
    await sleep(500);
    const results = await page.$$("div.cursor-pointer");
    if (results.length > 0) await results[0].click();
    await sleep(800);
  }
  // Re-expand curves
  for (const btn of await page.$$("button")) {
    const text = await btn.textContent();
    if (text?.includes("展开曲线")) { await btn.click(); break; }
  }
  await sleep(1000);
  await page.screenshot({ path: path.join(OUT, "18-dynamic-pipe-chart.png"), fullPage: false });

  // Final checks
  console.log(`\nTotal canvas elements: ${canvasCount}`);
  console.log(`Page errors: ${errors.length}`);
  errors.forEach(e => console.log(`  ERROR: ${e}`));

  // Scene data checks
  const sceneData = await page.evaluate(() => {
    const canvases = document.querySelectorAll("canvas");
    return {
      canvasCount: canvases.length,
      hasTimeline: !!document.querySelector("input[type='range']"),
    };
  });
  console.log("Scene check:", JSON.stringify(sceneData));

  await browser.close();
  console.log("\nScreenshots saved to:", OUT);
}

main().catch(e => { console.error(e); process.exit(1); });
