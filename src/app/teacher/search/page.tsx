"use client";

import React, { useState } from "react";
import { useApp, getAuthToken } from "@/contexts/AppContext";

export default function SearchTestPage() {
  const { state } = useApp();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [chunks, setChunks] = useState<any[]>([]);

  if (!state.role || state.role !== "teacher") {
    return <div className="p-8 text-center text-red-500">仅教师可访问</div>;
  }

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResults(null); setChunks([]);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ action: "knowledge", params: { question: query } }),
      });
      const data = await res.json();
      setResults(data);
      setChunks(data.references || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      <h1 className="text-2xl font-bold mb-2">知识库检索测试</h1>
      <p className="text-sm text-[var(--color-text-secondary)] mb-6">测试向量检索效果，查看匹配文档和相似度</p>

      <div className="flex gap-3 mb-6">
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()}
          placeholder="输入测试问题..." className="flex-1 px-4 py-3 rounded-lg border text-base focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
        <button onClick={search} disabled={loading} className="px-6 py-3 bg-[var(--color-primary)] text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50">
          {loading ? "检索中..." : "检索"}
        </button>
      </div>

      {chunks.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-bold mb-3">匹配片段 ({chunks.length}条)</h3>
          <div className="space-y-3">
            {chunks.map((c: any, i: number) => (
              <div key={i} className="bg-white rounded-xl border p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{c.docName}</span>
                  <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{c.similarity}</span>
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] bg-gray-50 rounded p-3">{c.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results?.answer && (
        <div className="bg-white rounded-xl border p-6">
          <h3 className="text-sm font-bold mb-3">AI 回答</h3>
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{results.answer}</div>
        </div>
      )}
    </div>
  );
}
