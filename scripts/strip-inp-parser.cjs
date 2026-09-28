// 清理残留:删除 import 块后的孤立 '}' 与多余空行
const fs = require('fs');
const p = 'src/app/sandbox/page.tsx';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
// 找到 '}' 单独成行且在 VISUAL CONSTANTS 之前
const idx = lines.findIndex((l, i) => l.trim() === '}' && i < 20);
if (idx < 0) throw new Error('stray } not found');
lines.splice(idx, 1);
// 压缩连续空行为 1 个
const out = [];
for (const l of lines) { if (l.trim() === '' && out.length && out[out.length - 1].trim() === '') continue; out.push(l); }
fs.writeFileSync(p, out.join('\n'), 'utf8');
console.log('OK, removed stray } at', idx, '-> total', out.length);
