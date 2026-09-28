// 删除残留 computeLayout 函数体:从 '/**' 到 'return [...placed.values()];' 后的 '}'
const fs = require('fs');
const p = 'src/components/KnowledgeGraphPanel.tsx';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const start = lines.findIndex((l) => l.trim() === '/**');
const ret = lines.findIndex((l, i) => i > start && l.includes('return [...placed.values()]'));
if (start < 0 || ret < 0) throw new Error('anchors not found: ' + start + ',' + ret);
// ret 行之后应有一个单独的 '}' 作为函数结尾
let end = -1;
for (let i = ret + 1; i < lines.length; i++) { if (lines[i].trim() === '}') { end = i; break; } }
if (end < 0) throw new Error('closing brace not found');
const out = [...lines.slice(0, start), ...lines.slice(end + 1)];
fs.writeFileSync(p, out.join('\n'), 'utf8');
console.log('OK removed', start, '..', end, '-> total', out.length);
