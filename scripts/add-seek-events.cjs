// 批量给 ChartPanel 内所有 ReactEChartsCore 加 onEvents={seekEvents}
const fs = require("fs");
const p = "src/app/sandbox/page.tsx";
let t = fs.readFileSync(p, "utf8");
const before = t;
t = t.split("notMerge />").join("notMerge onEvents={seekEvents} />");
fs.writeFileSync(p, t);
console.log("replaced:", (before.match(/notMerge \/>/g) || []).length, "occurrences");
