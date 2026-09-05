"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/contexts/AppContext";
import ClassesTab from "./ClassesTab";
import TasksTab from "./TasksTab";
import AnalysisTab from "./AnalysisTab";
import ReviewTab from "./ReviewTab";
import KnowledgeTab from "./KnowledgeTab";

type TabKey = "classes" | "tasks" | "analysis" | "review" | "knowledge";

export default function TeacherPage() {
  const { state } = useApp();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (state.authLoading) return;
    if (!state.role) router.replace("/login?redirect=" + encodeURIComponent("/teacher"));
    else if (state.role !== "teacher" && state.role !== "admin") router.replace("/");
    else setAuthorized(true);
  }, [state.authLoading, state.role, router]);

  const [activeTab, setActiveTab] = useState<TabKey>("classes");

  if (state.authLoading || !authorized) {
    return <div className="flex items-center justify-center min-h-[60vh] text-[var(--color-text-muted)]">加载中...</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)] mb-1">教学管理</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">班级与学生、学习任务、学情分析、AI 内容审核与知识库</p>
      </div>

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {[
          { k: "classes" as TabKey, l: "🏫 班级" },
          { k: "tasks" as TabKey, l: "📝 任务" },
          { k: "analysis" as TabKey, l: "📊 学情" },
          { k: "review" as TabKey, l: "🛡️ AI审核" },
          { k: "knowledge" as TabKey, l: "📚 知识库" },
        ].map((t) => (
          <button key={t.k} onClick={() => setActiveTab(t.k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === t.k ? "bg-white text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"}`}>
            {t.l}
          </button>
        ))}
      </div>

      {activeTab === "classes" && <ClassesTab />}
      {activeTab === "tasks" && <TasksTab />}
      {activeTab === "analysis" && <AnalysisTab />}
      {activeTab === "review" && <ReviewTab />}
      {activeTab === "knowledge" && <KnowledgeTab />}
    </div>
  );
}
