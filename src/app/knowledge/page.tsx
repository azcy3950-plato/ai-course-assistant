'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { useApp } from '@/contexts/AppContext';
import { useLearning } from '@/contexts/LearningContext';
import { supabase } from '@/lib/supabase';
import {
  generateKnowledgeNodeQuiz,
  getKnowledgeGraph,
  queryKnowledgeAgentStream,
  recordKnowledgeNodeInteraction,
} from '@/services/agent';
import ChatMessage from '@/components/ChatMessage';
import ChatInput from '@/components/ChatInput';
import SourceCard from '@/components/SourceCard';
import QuizPanel from '@/components/QuizPanel';
import KnowledgeGraphPanel from '@/components/KnowledgeGraphPanel';
import KnowledgeNodeDrawer from '@/components/KnowledgeNodeDrawer';
import type {
  GraphContext,
  KnowledgeGraph,
  KnowledgeNode,
  KnowledgeNodeAction,
  Reference,
} from '@/types';

const lateralRelations = new Set(['related', 'applied_in', 'governed_by']);

function graphContextForNode(node: KnowledgeNode, graph: KnowledgeGraph): GraphContext {
  const byId = new Map(graph.nodes.map((item) => [item.id, item]));
  const prerequisites: KnowledgeNode[] = [];
  const relatedNodes: KnowledgeNode[] = [];
  const nextNodes: KnowledgeNode[] = [];
  const highlightEdges: string[] = [];

  graph.edges.forEach((edge) => {
    if (edge.source !== node.id && edge.target !== node.id) return;
    const otherId = edge.source === node.id ? edge.target : edge.source;
    const other = byId.get(otherId);
    if (!other) return;
    highlightEdges.push(edge.id);
    if (lateralRelations.has(edge.relation)) relatedNodes.push(other);
    else if (edge.target === node.id) prerequisites.push(other);
    else nextNodes.push(other);
  });

  const suggestedNextNode = [...nextNodes, ...relatedNodes]
    .sort((a, b) => (a.progress?.mastery || 0) - (b.progress?.mastery || 0))[0];

  return {
    focusNode: byId.get(node.id) || node,
    prerequisites,
    relatedNodes,
    nextNodes,
    highlightNodeIds: [
      node.id,
      ...prerequisites.map((item) => item.id),
      ...relatedNodes.map((item) => item.id),
      ...nextNodes.map((item) => item.id),
    ],
    highlightEdges,
    suggestedNextNode,
  };
}

export default function KnowledgePage() {
  const { state: chatState, createConversation, setActive, addMessage, deleteConversation, updateTitle, updateLastMessage, getActiveConversation } = useChat();
  const { state: appState } = useApp();
  const { addRecord } = useLearning();

  const [loading, setLoading] = useState(false);
  const [highlightedRef, setHighlightedRef] = useState<number | null>(null);
  const [allReferences, setAllReferences] = useState<Reference[]>([]);
  const [graph, setGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [graphContext, setGraphContext] = useState<GraphContext>();
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphError, setGraphError] = useState('');
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode>();
  const [graphDepth, setGraphDepth] = useState<1 | 2>(2);
  const [rightTab, setRightTab] = useState<'graph' | 'references'>('graph');
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sourcePanelRef = useRef<HTMLDivElement>(null);

  const activeConv = getActiveConversation();

  // Auto-create conversation if none exists
  useEffect(() => {
    if (!chatState.activeConversationId) {
      createConversation();
    }
  }, [chatState.activeConversationId, createConversation]);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages]);

  const refreshGraph = useCallback(async () => {
    setGraphLoading(true);
    try {
      const data = await getKnowledgeGraph();
      setGraph(data.graph);
      setGraphError('');
    } catch {
      setGraphError('知识图谱暂时无法加载，请检查数据库连接。');
    } finally {
      setGraphLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshGraph();
  }, [refreshGraph]);

  const mergeContextProgress = useCallback((context: GraphContext) => {
    const contextNodes = [context.focusNode, ...context.prerequisites, ...context.relatedNodes, ...context.nextNodes];
    const updates = new Map(contextNodes.map((node) => [node.id, node]));
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => updates.has(node.id) ? { ...node, ...updates.get(node.id) } : node),
    }));
  }, []);

  const handleSend = useCallback(async (content: string) => {
    if (!activeConv) return;

    // Add user message
    addMessage(activeConv.id, { role: 'user', content });

    // Query agent
    setLoading(true);
    // Add placeholder for streaming
    addMessage(activeConv.id, { role: 'assistant', content: '' });
    try {
      let fullAnswer = '';
      let turnContext: GraphContext | undefined;
      const response = await queryKnowledgeAgentStream(content, (text) => {
        fullAnswer = text;
        updateLastMessage(activeConv.id, text);
      }, (refs) => {
        setAllReferences(refs);
      }, (context) => {
        turnContext = context;
        setGraphContext(context);
        mergeContextProgress(context);
        setGraphDepth(1);
        setRightTab('graph');
      });

      // Auto-title
      if (activeConv.title === '新对话') {
        const shortQ = content.length > 30 ? content.slice(0, 30) + '...' : content;
        updateTitle(activeConv.id, shortQ);
      }

      // Save record
      try {
        const { data: s } = await supabase.auth.getSession();
        let em = s.session?.user?.email || '';
        if (!em) {
          try { em = JSON.parse(localStorage.getItem('aicourse-user') || '{}').email || ''; } catch {}
        }
        if (em) {
          const currentContext = turnContext || response.graphContext;
          await fetch('/api/records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_email: em,
              question: content,
              answer_summary: fullAnswer.slice(0, 200),
              keywords: currentContext?.focusNode.keywords || [],
              topics: currentContext ? [currentContext.focusNode.id] : [],
              has_references: Boolean(response.references?.length),
            }),
          });
          const qr = await fetch('/api/quiz?email=' + encodeURIComponent(em));
          const qd = await qr.json();
          if (qd.needsQuiz && qd.questions?.length) { setQuizQuestions(qd.questions); setQuizOpen(true); }
        }
      } catch (e) {}

      addRecord('knowledge', content.slice(0, 30) + (content.length > 30 ? '...' : ''), `查询了关于"${content.slice(0, 50)}"的内容`);
    } catch (err) {
      updateLastMessage(activeConv.id, '抱歉，查询时出现了错误。请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [activeConv, addMessage, addRecord, mergeContextProgress, updateLastMessage, updateTitle]);

  const handleRegenerate = useCallback(async () => {
    if (!activeConv || loading) return;
    const msgs = activeConv.messages;
    // Find last user message
    let lastUserMsg = '';
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { lastUserMsg = msgs[i].content; break; }
    }
    if (!lastUserMsg) return;
    // Remove last AI message
    const updatedMessages = msgs.slice(0, -1);
    activeConv.messages = updatedMessages;
    chatState.conversations = chatState.conversations.map(c => c.id === activeConv.id ? { ...c, messages: updatedMessages } : c);
    // Re-send
    handleSend(lastUserMsg);
  }, [activeConv, loading, handleSend, chatState.conversations]);

  const handleReferenceClick = useCallback((refId: number) => {
    setHighlightedRef(prev => prev === refId ? null : refId);
    setRightTab('references');
    // Scroll to source in right panel
    window.setTimeout(() => {
      const el = document.getElementById(`source-${refId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }, []);

  const handleNodeClick = useCallback(async (node: KnowledgeNode) => {
    setGraphDepth(1);
    setRightTab('graph');
    setSelectedNode(node);
    setGraphContext(graphContextForNode(node, graph));
    const progress = await recordKnowledgeNodeInteraction(node.id, 'study');
    if (!progress) return;
    const updated = { ...node, progress };
    setSelectedNode(updated);
    setGraphContext((current) => current?.focusNode.id === node.id
      ? { ...current, focusNode: updated }
      : current);
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((item) => item.id === node.id ? updated : item),
    }));
  }, [graph]);

  const handleNodeAction = useCallback(async (action: KnowledgeNodeAction, node: KnowledgeNode, targetNode?: KnowledgeNode) => {
    if (action === 'explain') {
      setSelectedNode(undefined);
      await handleSend(`请讲解知识图谱中的“${node.name}”节点，并结合我的掌握情况说明前置知识、相关知识和后续应用。`);
      return;
    }
    if (action === 'learn_prerequisite') {
      const edge = graph.edges.find((item) => item.target === node.id && !['related', 'applied_in', 'governed_by'].includes(item.relation));
      const prerequisite = edge ? graph.nodes.find((item) => item.id === edge.source) : undefined;
      setSelectedNode(undefined);
      await handleSend(prerequisite
        ? `我想学习“${node.name}”，请先从它的前置知识“${prerequisite.name}”开始讲解。`
        : `请从理解“${node.name}”所需的基础知识开始讲解；只能使用知识图谱数据库中的节点。`);
      return;
    }
    if (action === 'learn_next') {
      const recommendedNode = targetNode || (() => {
        const edge = graph.edges.find((item) => item.source === node.id && !['related', 'applied_in', 'governed_by'].includes(item.relation));
        return edge ? graph.nodes.find((item) => item.id === edge.target) : undefined;
      })();
      if (!recommendedNode) return;
      await recordKnowledgeNodeInteraction(recommendedNode.id, 'study');
      setSelectedNode(undefined);
      await handleSend(`我已经学习了“${node.name}”，知识图谱推荐我下一步学习“${recommendedNode.name}”。请说明推荐理由，并从这个知识节点开始引导我学习；只能使用知识图谱数据库中真实存在的节点和关系。`);
      return;
    }
    if (action === 'practice') {
      try {
        const questions = await generateKnowledgeNodeQuiz(node.id);
        if (questions.length) {
          setQuizQuestions(questions);
          setQuizOpen(true);
          setSelectedNode(undefined);
        }
      } catch {
        // Keep the drawer open so the student can retry without losing context.
      }
      return;
    }
    const resourceRefs: Reference[] = node.resources.map((resource, index) => ({
      id: index + 1,
      docName: resource.docName,
      chapter: resource.chapter,
      page: resource.page || 0,
      snippet: resource.snippet || resource.title,
      fileUrl: resource.url,
    }));
    setAllReferences(resourceRefs);
    setRightTab('references');
    setSelectedNode(undefined);
  }, [graph.edges, graph.nodes, handleSend]);

  const handleNewConversation = () => {
    setAllReferences([]);
    setHighlightedRef(null);
    setGraphContext(undefined);
    setSelectedNode(undefined);
    setGraphDepth(2);
    setRightTab('graph');
    createConversation();
  };

  const studentQuestions = [
    '城市内涝的主要成因是什么？',
    '海绵城市有哪些成功案例？',
    '暴雨强度公式中各参数的含义？',
    'SWMM模型如何用于内涝模拟？',
  ];

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Left: History Panel */}
      <aside className="w-48 bg-white border-r border-[var(--color-border)] flex flex-col shrink-0">
        <div className="p-3 border-b border-[var(--color-border)]">
          <button
            onClick={handleNewConversation}
            className="w-full py-2 px-3 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-primary-dark)] transition-colors flex items-center justify-center gap-1.5"
          >
            <span>+</span> 新建对话
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {chatState.conversations.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)] text-center py-8">
              暂无对话记录
            </p>
          )}
          {chatState.conversations.map(conv => (
            <div
              key={conv.id}
              className={`group flex items-center rounded-lg transition-colors ${
                conv.id === chatState.activeConversationId
                  ? 'bg-[var(--color-primary-bg)]'
                  : 'hover:bg-gray-50'
              }`}
            >
              <button
                onClick={() => setActive(conv.id)}
                className="flex-1 text-left px-3 py-2.5 text-sm truncate"
              >
                <div className="truncate text-[var(--color-text)]">{conv.title}</div>
                <div className="text-[10px] text-[var(--color-text-muted)]">
                  {new Date(conv.updatedAt).toLocaleDateString('zh-CN')}
                </div>
              </button>
              <button
                onClick={() => deleteConversation(conv.id)}
                className="opacity-0 group-hover:opacity-100 px-2 py-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-all shrink-0"
                title="删除对话"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Center: Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {(!activeConv || activeConv.messages.length === 0) ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-5xl mb-4">📚</div>
              <h2 className="text-xl font-bold text-[var(--color-text)] mb-2">
                智能体B · 知识图谱问答
              </h2>
              <p className="text-sm text-[var(--color-text-secondary)] mb-6 max-w-md">
                提问后自动定位知识节点、连接前置与后续知识，并基于课程资料给出可追溯回答
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {studentQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(q)}
                    disabled={loading}
                    className="text-sm px-4 py-2 bg-white border border-[var(--color-border)] rounded-full hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors text-[var(--color-text-secondary)] disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              {activeConv.messages.map(msg => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onReferenceClick={handleReferenceClick}
                  highlightedRef={highlightedRef}
                  onRegenerate={msg.role === 'assistant' && msg.id === activeConv.messages[activeConv.messages.length - 1]?.id ? handleRegenerate : undefined}
                />
              ))}
              {loading && (
                <div className="flex items-center gap-3 py-4">
                  <div className="w-8 h-8 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center text-sm">AI</div>
                  <div className="bg-white border border-[var(--color-border)] rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-[var(--color-primary)] rounded-full animate-bounce" style={{animationDelay:'0ms'}} />
                      <span className="w-2 h-2 bg-[var(--color-primary)] rounded-full animate-bounce" style={{animationDelay:'150ms'}} />
                      <span className="w-2 h-2 bg-[var(--color-primary)] rounded-full animate-bounce" style={{animationDelay:'300ms'}} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        <div className="mx-4 mb-3 flex flex-wrap gap-2">
            {["海绵城市的核心技术有哪些？","暴雨重现期怎么确定？","SWMM模型的主要功能是什么？","LID设施的径流削减效果如何？"].map(q => (
              <button key={q} onClick={() => handleSend(q)} disabled={loading} className="text-xs px-3 py-1.5 bg-blue-50 text-[var(--color-primary)] rounded-full hover:bg-blue-100 transition-colors disabled:opacity-50">{q}</button>
            ))}
          </div>
        <ChatInput onSend={handleSend} disabled={loading} placeholder="输入课程知识相关问题..." />
      </div>

      {/* Right: Knowledge graph / references */}
      <aside
        ref={sourcePanelRef}
        className="flex w-[clamp(620px,52vw,820px)] shrink-0 flex-col border-l border-[var(--color-border)] bg-white"
      >
        <div className="grid grid-cols-2 border-b border-[var(--color-border)] bg-white p-2">
          <button
            onClick={() => setRightTab('graph')}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${rightTab === 'graph' ? 'bg-[var(--color-primary-bg)] text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-slate-50'}`}
          >
            ◉ 知识图谱
          </button>
          <button
            onClick={() => setRightTab('references')}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${rightTab === 'references' ? 'bg-[var(--color-primary-bg)] text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-slate-50'}`}
          >
            ▣ 引用来源 {allReferences.length ? `(${allReferences.length})` : ''}
          </button>
        </div>

        {rightTab === 'graph' ? (
          <div className="min-h-0 flex-1">
            {graphLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-muted)]">正在加载知识图谱…</div>
            ) : graphError ? (
              <div className="p-6 text-center">
                <p className="text-xs text-red-500">{graphError}</p>
                <button onClick={refreshGraph} className="mt-3 rounded-lg border px-3 py-1.5 text-xs text-[var(--color-primary)]">重新加载</button>
              </div>
            ) : (
              <KnowledgeGraphPanel
                graph={graph}
                graphContext={graphContext}
                selectedNodeId={selectedNode?.id}
                depth={graphDepth}
                onDepthChange={setGraphDepth}
                onNodeClick={handleNodeClick}
              />
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {allReferences.length === 0 ? (
              <div className="py-12 text-center">
                <div className="mb-2 text-3xl">📭</div>
                <p className="text-xs text-[var(--color-text-muted)]">暂无引用来源</p>
                <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">提问或查看节点资料后将在此显示</p>
              </div>
            ) : allReferences.map(ref => (
              <div key={ref.id} id={`source-${ref.id}`}>
                <SourceCard
                  reference={ref}
                  isHighlighted={highlightedRef === ref.id}
                  onClick={() => handleReferenceClick(ref.id)}
                />
              </div>
            ))}
          </div>
        )}
      </aside>
      {selectedNode && (
        <KnowledgeNodeDrawer
          node={selectedNode}
          graph={graph}
          suggestedNextNode={graphContext?.focusNode.id === selectedNode.id ? graphContext.suggestedNextNode : undefined}
          onClose={() => setSelectedNode(undefined)}
          onNodeClick={handleNodeClick}
          onAction={handleNodeAction}
        />
      )}
      {quizOpen && (
        <QuizPanel
          questions={quizQuestions}
          onClose={() => setQuizOpen(false)}
          onComplete={() => { setQuizOpen(false); refreshGraph(); }}
        />
      )}
    </div>
  );
}
