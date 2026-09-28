/**
 * 修复基础 INP 的 [LID_USAGE] 覆盖率乱值（历史注入 bug：2.48%~50000%，平均 194%）。
 * SWMM 只在不被 LID 覆盖的地表计算污染物积累/冲刷，覆盖率>100% 导致水质结果恒为 0。
 *
 * 修复规则：按子汇水区分组，若 LID 覆盖总和 >100%，等比缩放到 100%；
 * 其余行不动（保留相对分布）。字节安全（latin-1 往返，INP 为 GBK 编码）。
 * 用法：node scripts/fix-lid-usage.mjs [inp 路径]（默认 public/zijing_inp.inp，原地备份 .bak）
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { join } from "path";

const path = process.argv[2] || join(process.cwd(), "public", "zijing_inp.inp");
const raw = readFileSync(path, "latin1");

const start = raw.indexOf("[LID_USAGE]");
if (start < 0) {
  console.error("未找到 [LID_USAGE] 节");
  process.exit(1);
}
let end = raw.indexOf("\n[", start + 5);
if (end < 0) end = raw.length;
const block = raw.slice(start, end);
const lines = block.split("\n");
const header = lines[0];
const body = lines.slice(1);

// 解析行：Subcatchment LID_Process Number Area Width InitSat FromImp ToPerv ...
const rows = [];
for (let i = 0; i < body.length; i++) {
  const l = body[i];
  const t = l.trim();
  if (!t || t.startsWith(";") || t.startsWith("[")) continue;
  const p = l.split(/\s+/).filter((x) => x !== "");
  if (p.length < 4) continue;
  const area = parseFloat(p[3]);
  if (Number.isFinite(area)) rows.push({ i, p, area });
}

// 按子汇水区分组
const groups = new Map();
for (const r of rows) {
  if (!groups.has(r.p[0])) groups.set(r.p[0], []);
  groups.get(r.p[0]).push(r);
}

let changed = 0;
let cappedSubs = 0;
for (const [sub, list] of groups) {
  const sum = list.reduce((s, r) => s + r.area, 0);
  if (sum <= 100) continue;
  cappedSubs++;
  const factor = 100 / sum;
  for (const r of list) {
    const newArea = Math.round(r.area * factor * 100) / 100;
    if (newArea !== r.area) changed++;
    r.p[3] = String(newArea);
    body[r.i] = r.p.join(" ");
  }
}

const out = raw.slice(0, start) + [header, ...body].join("\n") + raw.slice(end);
if (existsSync(path + ".bak") === false) copyFileSync(path, path + ".bak");
writeFileSync(path, out, "latin1");

console.log(`修复完成：${rows.length} 行 LID_USAGE，${groups.size} 个子汇水区，${cappedSubs} 个需钳制，改写 ${changed} 行（备份 ${path}.bak）`);
