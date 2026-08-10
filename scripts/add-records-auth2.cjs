// 修复 records/page.tsx 与 summary/page.tsx:加 getAuthToken import + fetch 头
const fs = require('fs');

// records:单引号 import,在 supabase import 后追加
let t = fs.readFileSync('src/app/records/page.tsx', 'utf8');
t = t.replace(
  /import \{ supabase \} from '(@\/lib\/supabase)';/,
  `import { getAuthToken } from "@/contexts/AppContext";\nimport { supabase } from '@/lib/supabase';`,
);
t = t.replace(
  /fetch\('\/api\/records\?email=' \+ encodeURIComponent\(em\)\)/,
  `fetch('/api/records?email=' + encodeURIComponent(em), { headers: { Authorization: \`Bearer \${getAuthToken()}\` } })`,
);
fs.writeFileSync('src/app/records/page.tsx', t, 'utf8');
console.log('OK records');

// summary:已有 useApp import,已有 getAuthToken? 检查后追加
let s = fs.readFileSync('src/app/summary/page.tsx', 'utf8');
if (!s.includes('getAuthToken')) {
  s = s.replace(
    /import \{ useApp \} from "@\/contexts\/AppContext";/,
    `import { useApp, getAuthToken } from "@/contexts/AppContext";`,
  );
}
s = s.replace(
  /fetch\("\/api\/records\?email=" \+ encodeURIComponent\(em\)\)/g,
  `fetch("/api/records?email=" + encodeURIComponent(em), { headers: { Authorization: \`Bearer \${getAuthToken()}\` } })`,
);
fs.writeFileSync('src/app/summary/page.tsx', s, 'utf8');
console.log('OK summary');
