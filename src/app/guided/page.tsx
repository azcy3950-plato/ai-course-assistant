"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useApp } from "@/contexts/AppContext";
import KnowledgeGraphPanel from "@/components/KnowledgeGraphPanel";
import KnowledgeNodeDrawer from "@/components/KnowledgeNodeDrawer";
import QuizPanel from "@/components/QuizPanel";
import { generateKnowledgeNodeQuiz } from "@/services/agent";
import type { KnowledgeNode, KnowledgeNodeAction } from "@/types";

export default function GuidedPage() {
  const { state } = useApp();
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hints, setHints] = useState<string[]>([]);
  const [hintLevel, setHintLevel] = useState(0);
  const [kgData, setKgData] = useState<any>(null);
  const [showKg, setShowKg] = useState(true);
  const [selectedKgNode, setSelectedKgNode] = useState<KnowledgeNode | undefined>(undefined);
  const [graphFilter, setGraphFilter] = useState("");
  const [drawerNode, setDrawerNode] = useState<KnowledgeNode | undefined>(undefined);
  const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
  const [quizOpen, setQuizOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { fetch("/api/knowledge-graph").then(r => r.json()).then(d => setKgData(d)).catch(() => {}); }, []);

  const getToken = () => localStorage.getItem("aicourse-token") || "";

  const callAPI = async (action: string, params: any) => {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
      body: JSON.stringify({ action, params }),
    });
    return res.json();
  };

  const handleSend = useCallback(async (content?: string) => {
    const q = content || input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setLoading(true);
    setHintLevel(0);
    setHints([]);
    setGraphFilter(q);

    try {
      // System prompt: guide, don't answer directly
      const res = await callAPI("guided_start", {
        question: q,
        knowledgeGraph: kgData ? JSON.stringify(kgData.graph?.nodes?.slice(0, 5)) : "",
      });
      setMessages(prev => [...prev, { role: "assistant", content: res.greeting || "让我来引导你思考这个问题..." }]);
      // Pre-generate hints
      if (res.hints) setHints(res.hints);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "抱歉，出了点问题，请重试。" }]);
    }
    setLoading(false);
  }, [input, loading, kgData]);

  const requestHint = async () => {
    if (loading) return;
    setLoading(true);
    const newLevel = hintLevel + 1;
    setHintLevel(newLevel);
    try {
      const res = await callAPI("guided_hint", {
        question: messages.find(m => m.role === "user")?.content || "",
        hintsUsed: hintLevel,
        conversation: messages.slice(-6).map(m => m.content).join("\n"),
      });
      setMessages(prev => [...prev, { role: "assistant", content: "💡 提示 " + newLevel + "： " + (res.hint || "试着从课程知识中找线索") }]);
    } catch (e) {}
    setLoading(false);
  };

  const handleNodeAction = async (action: KnowledgeNodeAction, node: KnowledgeNode, targetNode?: KnowledgeNode) => {
    if (action === "quiz") {
      try {
        const questions = await generateKnowledgeNodeQuiz(node.id);
        setQuizQuestions(questions);
        setQuizOpen(true);
      } catch (e) {
        alert("生成题目失败");
      }
    } else if (action === "learn") {
      setInput("请讲解知识图谱中的" + node.name + "节点");
      setDrawerNode(undefined);
    } else if (action === "next" && targetNode) {
      setDrawerNode(targetNode);
      setSelectedKgNode(targetNode);
    } else if (action === "related" && targetNode) {
      setDrawerNode(targetNode);
      setSelectedKgNode(targetNode);
    }
  };

  if (!state.role) return <div className="p-8 text-center">请先登录</div>;

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Knowledge Graph Sidebar */}
      {showKg && kgData && (
        <aside className="w-[380px] bg-white border-r border-[var(--color-border)] shrink-0 flex flex-col">
          <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-sm font-bold">📊 知识图谱</h3>
              <p className="text-[10px] text-[var(--color-text-muted)]">点击节点开始学习</p>
            </div>
            {graphFilter && <button onClick={() => setGraphFilter("")} className="text-[10px] text-[var(--color-primary)] hover:underline mr-2">显示全部</button>}<button onClick={() => setShowKg(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="flex-1 min-h-0">
            <KnowledgeGraphPanel
              graph={(() => { const g = kgData.graph || { nodes: [], edges: [] }; if (!graphFilter) return g; const q = graphFilter.toLowerCase(); const hitIds = new Set(g.nodes.filter(function(n) { const name = (n.name || "").toLowerCase(); const kws = (n.keywords || []).map(function(k) { return k.toLowerCase(); }); return q.includes(name) || name.includes(q) || kws.some(function(k) { return q.includes(k) || k.includes(q); }); }).map(function(n) { return n.id; })); if (hitIds.size === 0) return g; const allIds = new Set(hitIds); g.edges.forEach(function(e) { if (hitIds.has(e.source)) allIds.add(e.target); if (hitIds.has(e.target)) allIds.add(e.source); }); return { nodes: g.nodes.filter(function(n) { return allIds.has(n.id); }), edges: g.edges.filter(function(e) { return allIds.has(e.source) && allIds.has(e.target); }) }; })()}
              selectedNodeId={selectedKgNode?.id}
              depth={1}
              onDepthChange={() => {}}
              onNodeClick={(node: KnowledgeNode) => {
                setSelectedKgNode(node);
                setDrawerNode(node);
              }}
            />
          </div>
        </aside>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full">
        <div className="px-6 py-3 border-b bg-white flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-base font-bold">🧭 引导学习</h1>
            <p className="text-xs text-[var(--color-text-secondary)]">提出一个问题，AI 会引导你自己找到答案</p>
          </div>
          <button onClick={() => setShowKg(!showKg)}
            className={"text-xs px-3 py-1.5 rounded-lg border " + (showKg ? "bg-[var(--color-primary-bg)] text-[var(--color-primary)]" : "")}>
            📊 知识图谱
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">🧭</div>
              <h2 className="text-lg font-bold mb-2">引导式学习</h2>
              <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                我不会直接给你答案。我会通过提问和提示，帮助你一步步自己找到答案。
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
                {["海绵城市怎么减少内涝的？","排水管网设计标准怎么选？","SWMM模型的核心原理是什么？","LID设施有哪些？怎么组合使用？"].map(q => (
                  <button key={q} onClick={() => handleSend(q)} className="text-sm px-4 py-2 bg-blue-50 text-[var(--color-primary)] rounded-full hover:bg-blue-100">{q}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={"flex gap-3 " + (m.role === "user" ? "flex-row-reverse" : "")}>
              <div className={"w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm " + (m.role === "user" ? "bg-[var(--color-primary)] text-white" : "bg-green-500 text-white")}>
                {m.role === "user" ? "你" : "🧭"}
              </div>
              <div className={"max-w-[75%] rounded-2xl px-4 py-3 text-sm " + (m.role === "user" ? "bg-[var(--color-primary)] text-white" : "bg-white border text-[var(--color-text)]")}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && <div className="text-center text-sm text-[var(--color-text-muted)]">思考中...</div>}
          <div ref={endRef} />
        </div>

        {/* Input Area */}
        <div className="border-t bg-white p-4 shrink-0">
          <div className="flex gap-2 max-w-3xl mx-auto">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSend()}
              placeholder="提出你想学习的问题..."
              disabled={loading}
              className="flex-1 px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
            />
            <button onClick={() => handleSend()} disabled={loading || !input.trim()}
              className="px-5 py-3 bg-[var(--color-primary)] text-white rounded-xl text-sm font-medium disabled:opacity-50">
              发送
            </button>
            <button onClick={requestHint} disabled={loading || hintLevel >= 4}
              className="px-4 py-3 border rounded-xl text-sm text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] disabled:opacity-30"
              title={hintLevel >= 4 ? "最多4级提示" : "获取提示"}>
              💡{hintLevel > 0 ? hintLevel : ""}
            </button>
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-2">💡 按钮 = 获取逐级提示（共 4 级）</p>
        </div>
      </div>
      {drawerNode && kgData?.graph && (
        <KnowledgeNodeDrawer
          node={drawerNode}
          graph={kgData.graph}
          onClose={() => setDrawerNode(undefined)}
          onNodeClick={(node: KnowledgeNode) => {
            setDrawerNode(node);
            setSelectedKgNode(node);
          }}
          onAction={handleNodeAction}
        />
      )}
      {quizOpen && (
        <QuizPanel
          questions={quizQuestions}
          onClose={() => setQuizOpen(false)}
          onComplete={() => { setQuizOpen(false); }}
        />
      )}
    </div>
  );
}
