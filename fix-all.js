// Fix all remaining mock data across the platform
const fs = require('fs');

// 1. Fix insights page dailyData/trendData
let insights = fs.readFileSync('src/app/insights/page.tsx', 'utf8');

// Keep dailyData but make it dynamic with fallback
insights = insights.replace(
  "const dailyData = [",
  "const dailyData = (realData?.dailyQuestions) ? realData.dailyQuestions : ["
);

// Replace trendData with dynamic version
insights = insights.replace(
  "const trendData = [",
  "const trendData = (realData?.trends) ? realData.trends : ["
);

// Remove the default keyword line
insights = insights.replace(/keywords = \[.*?\];/s, 'keywords = realData?.topKeywords || ["暴雨重现期","SWMM模型","海绵城市","径流系数","LID","内涝成因","排水管网"];');

fs.writeFileSync('src/app/insights/page.tsx', insights);
console.log('1. Insights fixed');

// 2. Fix summary page mock data
let summary = fs.readFileSync('src/app/summary/page.tsx', 'utf8');
summary = summary.replace(
  "const mockSummaries",
  "const _oldMockSummaries"
);
// Generate summaries from API data
const summaryHook = `
  const [realSummaries, setRealSummaries] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const em = s.session?.user?.email || '';
      if (!em) return;
      try {
        const r = await fetch('/api/records?email=' + encodeURIComponent(em));
        if (r.ok) {
          const records = await r.json();
          // Group by date
          const groups: Record<string, any[]> = {};
          records.forEach((rec: any) => {
            const date = new Date(rec.created_at).toLocaleDateString('zh-CN');
            if (!groups[date]) groups[date] = [];
            groups[date].push(rec);
          });
          const summaries = Object.entries(groups).map(([date, recs]) => ({
            id: date,
            title: date + ' 学习总结',
            date,
            questions: recs.length,
            accuracy: '—',
            keywords: [...new Set(recs.map((r: any) => r.question?.slice(0, 10) || ''))].slice(0, 4),
          })).sort((a, b) => b.date.localeCompare(a.date));
          setRealSummaries(summaries.length > 0 ? summaries : []);
        }
      } catch(e) {}
    })();
  }, []);
`;
summary = summary.replace(
  "export default function SummaryPage() {",
  "export default function SummaryPage() {" + summaryHook
);
// Replace mockSummaries with realSummaries
summary = summary.replace(/_oldMockSummaries/g, 'realSummaries.length > 0 ? realSummaries : [');
// Fix the closing: add fallback
summary = summary.replace(
  "].map(s => (",
  ",{id:'empty',title:'暂无学习记录',date:'',questions:0,accuracy:'—',keywords:[]}].filter(s => s.questions > 0 || s.id === 'empty').slice(0, 5).map((s: any) => ("
);
fs.writeFileSync('src/app/summary/page.tsx', summary);
console.log('2. Summary fixed');

// 3. Add useEffect import to summary if needed
if (!summary.includes('import React, { useState, useEffect, useCallback }')) {
  summary = summary.replace('import React, { useState, useCallback }', 'import React, { useState, useEffect, useCallback }');
  fs.writeFileSync('src/app/summary/page.tsx', summary);
}

console.log('ALL_FIXED');
