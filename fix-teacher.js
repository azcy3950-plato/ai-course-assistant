const fs = require('fs');
let code = fs.readFileSync('src/app/teacher/page.tsx', 'utf8');

// Add Link import
code = code.replace("import { useRouter, useSearchParams }", "import Link from \"next/link\";\nimport { useRouter, useSearchParams }");

// Add realStudents + dashboardData state after filterType
code = code.replace(
  'const [filterType, setFilterType] = useState("全部");',
  'const [filterType, setFilterType] = useState("全部");\n  const [realStudents, setRealStudents] = useState<any[]>([]);\n  const [dashboardData, setDashboardData] = useState<any>(null);'
);

// Fetch real data
code = code.replace(
  "useEffect(() => { if (authorized) loadDocs(); }, [authorized, loadDocs]);",
  "useEffect(() => { if (authorized) { loadDocs(); fetch(\"/api/students\").then(r => r.json()).then(d => { if (Array.isArray(d)) setRealStudents(d); }).catch(() => {}); fetch(\"/api/teacher-stats\").then(r => r.json()).then(d => setDashboardData(d)).catch(() => {}); } }, [authorized, loadDocs]);"
);

// Replace student stat cards with real data
const oldStatsLine = code.match(/\[\"👥\", mockStudents\.length.*\"沙盘实验\"\]/g);
if (oldStatsLine && oldStatsLine[0]) {
  code = code.replace(oldStatsLine[0],
    '["👥", dashboardData?.studentCount || realStudents.length || 0, "学生总数"], ["💬", dashboardData?.totalQuestions || 0, "总提问"], ["📝", dashboardData?.totalQuizzes || 0, "总测验"], ["✅", (dashboardData?.quizRate || 0) + "%", "正确率"]');
}

// Replace table header
code = code.replace(
  '["姓名", "总访问", "知识查询", "完成引导", "沙盘", "最近活跃"]',
  '["姓名", "提问", "测验", "正确率", "正确/总数", "最近活跃"]'
);

// Replace mock student mapping with real student mapping
// Find the mockStudents.map section and replace it
const mockMapStart = code.indexOf('mockStudents.map(stu => (');
if (mockMapStart > 0) {
  // Find the matching closing of the map
  const afterMap = code.substring(mockMapStart);
  // Find ))}</tbody>
  const mapEnd = afterMap.indexOf('))}</tbody>') + 11;
  const beforeMap = code.substring(0, mockMapStart);
  const afterMapEnd = code.substring(mockMapStart + mapEnd);

  const newStudentRow = `(realStudents.length > 0 ? realStudents : [{email:"暂无学生数据",totalQuestions:0,totalQuizzes:0,correct:0,rate:0,lastActive:null}]).map((stu: any) => (
              <tr key={stu.email} className="border-b hover:bg-gray-50">
                <td className="px-5 py-3 font-medium"><Link href={"/teacher/students/" + encodeURIComponent(stu.email || "")} className="text-[var(--color-primary)] hover:underline">{(stu.email||"").split("@")[0]}</Link></td>
                <td className="text-center px-3 py-3 text-[var(--color-text-secondary)]">{stu.totalQuestions}</td>
                <td className="text-center px-3 py-3 text-[var(--color-text-secondary)]">{stu.totalQuizzes}</td>
                <td className="text-center px-3 py-3"><span className={"text-xs px-2 py-0.5 rounded-full font-medium " + (stu.rate >= 70 ? "bg-green-100 text-green-700" : stu.rate >= 50 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700")}>{stu.rate}%</span></td>
                <td className="text-center px-3 py-3 text-[var(--color-text-secondary)]">{stu.correct}/{stu.totalQuizzes}</td>
                <td className="text-center px-3 py-3 text-xs text-[var(--color-text-muted)]">{stu.lastActive ? new Date(stu.lastActive).toLocaleDateString("zh-CN") : "—"}</td>
              </tr>
            ))}</tbody>`;

  code = beforeMap + newStudentRow + afterMapEnd;
}

fs.writeFileSync('src/app/teacher/page.tsx', code);
console.log('TEACHER_FIXED');
