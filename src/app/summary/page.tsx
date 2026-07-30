"use client";

import React, { useState, useCallback } from "react";
import { useApp } from "@/contexts/AppContext";
import { supabase } from "@/lib/supabase";

const mockSummaries = [
  { id: "1", title: "海绵城市核心技术学习总结", date: "2026-07-21", questions: 8, accuracy: "88%", keywords: ["海绵城市","LID","径流控制","透水铺装"] },
  { id: "2", title: "暴雨强度公式推导练习", date: "2026-07-20", questions: 5, accuracy: "80%", keywords: ["暴雨公式","重现期","推理公式法","设计流量"] },
  { id: "3", title: "SWMM模型入门学习", date: "2026-07-19", questions: 6, accuracy: "67%", keywords: ["SWMM","降雨-径流","管网水力","模拟"] },
];

export default function SummaryPage() {
  const { state } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const downloadPDF = useCallback(async (title: string) => {
    setExporting(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("澄知 · 韧性城市学习平台", 20, 20);
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text("北京师范大学 · 基础设施规划课程", 20, 30);
      doc.text("学习总结报告", 20, 40);
      doc.setFontSize(10);
      doc.text("生成日期: " + new Date().toLocaleDateString("zh-CN"), 20, 50);
      doc.text("报告主题: " + title, 20, 58);
      doc.line(20, 63, 190, 63);
      doc.setFontSize(11);
      doc.text("学习内容摘要：", 20, 73);
      const { data: sess } = await supabase.auth.getSession();
      const em = sess.session?.user?.email || "";
      if (em) {
        const r = await fetch("/api/records?email=" + encodeURIComponent(em));
        if (r.ok) {
          const records = await r.json();
          let y = 81;
          records.slice(0, 20).forEach((rec: any, i: number) => {
            const q = rec.question.length > 70 ? rec.question.slice(0, 70) + "..." : rec.question;
            doc.text((i + 1) + ". " + q, 20, y);
            y += 7;
            if (y > 270) { doc.addPage(); y = 20; }
          });
        }
      }
      doc.save("学习总结_" + title.replace(/[^a-zA-Z0-9一-鿿]/g, "_") + ".pdf");
    } catch (e) { console.error(e); alert("导出失败"); }
    finally { setExporting(false); }
  }, []);

  const downloadWord = useCallback(async (title: string) => {
    setExporting(true);
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
      const { data: sess } = await supabase.auth.getSession();
      const em = sess.session?.user?.email || "";
      const children: any[] = [
        new Paragraph({ text: "澄知 · 韧性城市学习平台", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: "北京师范大学 · 基础设施规划课程" }),
        new Paragraph({ text: "学习总结报告: " + title, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "生成日期: " + new Date().toLocaleDateString("zh-CN") }),
        new Paragraph({ text: "" }),
      ];
      if (em) {
        const r = await fetch("/api/records?email=" + encodeURIComponent(em));
        if (r.ok) {
          const records = await r.json();
          children.push(new Paragraph({ text: "学习内容:", heading: HeadingLevel.HEADING_3 }));
          records.slice(0, 20).forEach((rec: any, i: number) => {
            children.push(new Paragraph({ text: (i + 1) + ". " + rec.question }));
          });
        }
      }
      const doc = new Document({ sections: [{ children }] });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "学习总结_" + title.replace(/[^a-zA-Z0-9一-鿿]/g, "_") + ".docx";
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
    finally { setExporting(false); }
  }, []);

  if (!state.role) return <div className="p-8 text-center">请先登录</div>;

  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">学习总结</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">查看和导出学习报告</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[["本次学习","8 问题","📋"],["今日","12 问题","📅"],["本周","32 问题","📊"]].map(([t,n,i]) => (
          <div key={String(t)} className="bg-white rounded-xl border border-[var(--color-border)] p-5 cursor-pointer hover:border-[var(--color-primary)] transition-colors">
            <div className="flex items-center justify-between"><span className="text-sm font-bold">{t}</span><span className="text-lg">{i}</span></div>
            <div className="text-lg mt-2">{n}</div>
            <div className="text-xs text-[var(--color-primary)] mt-2">生成报告 →</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-[var(--color-border)]">
        <div className="px-5 py-3 border-b"><h3 className="text-sm font-bold">历史报告</h3></div>
        {mockSummaries.map(s => (
          <div key={s.id} className="border-b px-5 py-4 hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(s.id === selected ? null : s.id)}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-xs text-[var(--color-text-muted)] mt-1">{s.date} · {s.questions} 个问题 · 正确率 {s.accuracy}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => downloadPDF(s.title)} disabled={exporting} className="px-3 py-1 text-xs border border-[var(--color-border)] rounded-lg hover:bg-gray-50 disabled:opacity-50">{exporting ? "生成中..." : "PDF"} <span className="ml-1 text-[10px]">|</span> <button onClick={() => downloadWord(s.title)} disabled={exporting} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-primary)] disabled:opacity-50">Word</button></button>
              </div>
            </div>
            {selected === s.id && (
              <div className="mt-3 pt-3 border-t text-sm">
                <div className="flex flex-wrap gap-2 mb-2">{s.keywords.map(k => <span key={k} className="px-2 py-0.5 bg-blue-50 text-[var(--color-primary)] rounded text-xs">{k}</span>)}</div>
                <p className="text-[var(--color-text-secondary)]">涵盖海绵城市核心技术、LID设施分类、径流控制目标等知识点，完成阶段检测2次，整体掌握良好。</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
