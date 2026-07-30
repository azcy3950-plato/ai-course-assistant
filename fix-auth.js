const fs = require('fs');
const files = [
  'src/components/QuizPanel.tsx','src/app/summary/page.tsx','src/app/records/page.tsx',
  'src/app/sandbox/components/AIChat.tsx','src/app/insights/page.tsx',
  'src/app/teacher/search/page.tsx','src/app/teacher/page.tsx','src/app/portrait/page.tsx',
  'src/app/knowledge/page.tsx'
];
files.forEach(f => {
  if (!fs.existsSync(f)) { console.log('SKIP:', f); return; }
  let code = fs.readFileSync(f, 'utf8');

  // Pattern 1: const { data } = await supabase.auth.getSession();
  code = code.replace(/const \{ ?data[^}]*\} ?= ?await supabase\.auth\.getSession\(\);?/g,
    'const token = localStorage.getItem("aicourse-token") || "";');

  // Pattern 2: data.session?.access_token || ""
  code = code.replace(/data\.session\?\.access_token \|\| ""/g, 'token || ""');
  code = code.replace(/data\.session\?\.access_token \|\| ''/g, "token || ''");

  // Pattern 3: data.session?.user?.email
  code = code.replace(/data\.session\?\.user\?\.email/g,
    '(JSON.parse(localStorage.getItem("aicourse-user")||"{}")).email');

  fs.writeFileSync(f, code);
  console.log('OK:', f);
});
console.log('ALL_FIXED');
