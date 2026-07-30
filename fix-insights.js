const fs = require('fs');
let code = fs.readFileSync('src/app/insights/page.tsx', 'utf8');

// Add real data fetching
code = code.replace(
  'const [timeRange, setTimeRange] = useState("week");',
  'const [timeRange, setTimeRange] = useState("week");\n  const [realData, setRealData] = useState<any>(null);'
);

code = code.replace(
  "setLoading(false);\n    })();",
  "setLoading(false);\n    })();\n    fetch('/api/teacher-stats').then(r => r.json()).then(d => setRealData(d)).catch(() => {});"
);

// Replace hardcoded values
code = code.replace(/records\.length \|\| 45/g, "realData?.totalQuestions || records.length || 0");
code = code.replace(/Math\.round\(records\.length \* 0\.5\) \|\| 25/g, "Math.round((realData?.totalQuestions || 0) * 0.4)");
code = code.replace(/Math\.round\(records\.length \* 0\.3\) \|\| 18/g, "Math.round((realData?.totalQuestions || 0) * 0.3)");
code = code.replace(/Math\.round\(records\.length \* 0\.2\) \|\| 12/g, "Math.round((realData?.totalQuestions || 0) * 0.3)");
code = code.replace(/records\.length \|\| 32/g, "realData?.totalQuestions || records.length || 0");
code = code.replace('keywords.length', 'realData?.studentCount || 0');

fs.writeFileSync('src/app/insights/page.tsx', code);
console.log('INSIGHTS_FIXED');
