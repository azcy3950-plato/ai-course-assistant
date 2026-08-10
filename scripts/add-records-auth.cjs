// 给 5 个页面批量加 getAuthToken import + /api/records GET fetch 带 Authorization 头
const fs = require('fs');
const files = [
  'src/app/insights/page.tsx',
  'src/app/portrait/page.tsx',
  'src/app/page.tsx',
  'src/app/records/page.tsx',
  'src/app/summary/page.tsx',
];
for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  // import 加 getAuthToken(兼容单引号/双引号两种风格)
  if (!t.includes('getAuthToken')) {
    const m = t.match(/import \{ useApp \} from ['"]@\/contexts\/AppContext['"];/);
    if (m) {
      t = t.replace(m[0], `import { useApp, getAuthToken } from "@/contexts/AppContext";`);
    } else {
      throw new Error('import pattern not found in ' + f);
    }
  }
  // /api/records fetch 加 headers(仅对无 headers 的调用)
  t = t.replace(
    /fetch\(["']\/api\/records\?email=["'] \+ encodeURIComponent\(em\)\)/g,
    `fetch("/api/records?email=" + encodeURIComponent(em), { headers: { Authorization: \`Bearer \${getAuthToken()}\` } })`,
  );
  fs.writeFileSync(f, t, 'utf8');
  console.log('OK', f);
}
