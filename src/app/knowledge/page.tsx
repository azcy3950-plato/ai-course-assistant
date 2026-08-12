'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { useApp, getAuthToken } from '@/contexts/AppContext';
import { useLearning } from '@/contexts/LearningContext';
import { supabase } from '@/lib/supabase';
import { queryKnowledgeAgent, queryKnowledgeAgentStream } from '@/services/agent';
import ChatMessage from '@/components/ChatMessage';
import ChatInput from '@/components/ChatInput';
import SourceCard from '@/components/SourceCard';
import QuizPanel from '@/components/QuizPanel';
import { Reference } from '@/types';

export default function KnowledgePage() {
  const { state: chatState, createConversation, setActive, addMessage, deleteConversation, updateTitle, updateLastMessage, getActiveConversation } = useChat();
  const { state: appState } = useApp();
  const { addRecord } = useLearning();

  const [loading, setLoading] = useState(false);
  const [highlightedRef, setHighlightedRef] = useState<number | null>(null);
  const [allReferences, setAllReferences] = useState<Reference[]>([]);
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

  const handleSend = useCallback(async (content: string) => {
    if (!activeConv) return;

    // Add user message
    addMessage(activeConv.id, { role: 'user', content });

    // Query agent
    setLoading(true);
    // Add placeholder for streaming
    const placeholderId = Date.now().toString();
    addMessage(activeConv.id, { role: 'assistant', content: '' });
    try {
      let fullAnswer = '';
      const topicIds: string[] = []; // 本次提问命中的图谱节点 id(写入 records.topics)
      let lastRefs: Reference[] | undefined;
      const response = await queryKnowledgeAgentStream(content, (text) => {
        fullAnswer = text;
        if (activeConv) updateLastMessage(activeConv.id, text, lastRefs);
      }, (refs) => {
        lastRefs = refs; // 流式完成时写回当前消息 → 消息底部引用列表显示
        setAllReferences(refs);
      }, (ctx) => {
        if (ctx?.focusNode?.id && !topicIds.includes(ctx.focusNode.id)) {
          topicIds.push(ctx.focusNode.id, ...(ctx.highlightNodeIds || []).slice(0, 4).filter((id: string) => !topicIds.includes(id)));
        }
      });

      // 流结束后确保引用已挂到消息(最后一段文本更新已携带 lastRefs)
      if (activeConv && lastRefs?.length) updateLastMessage(activeConv.id, fullAnswer, lastRefs);

      // Auto-title
      if (activeConv.title === '新对话') {
        const shortQ = content.length > 30 ? content.slice(0, 30) + '...' : content;
        updateTitle(activeConv.id, shortQ);
      }

      // Save record(带图谱上下文节点 id 与引用标志,供小测按近期主题出题)
      try {
        const { data: s } = await supabase.auth.getSession();
        const em = s.session?.user?.email || '';
        if (em) {
          await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ user_email: em, question: content, answer_summary: fullAnswer.slice(0, 200), keywords: [], topics: topicIds, has_references: allReferences.length > 0 }) });
          const qr = await fetch('/api/quiz?email=' + encodeURIComponent(em), { headers: { Authorization: `Bearer ${getAuthToken()}` } });
          const qd = await qr.json();
          if (qd.needsQuiz && qd.questions?.length) { setQuizQuestions(qd.questions); setQuizOpen(true); }
        }
      } catch (e) {}

      addRecord('knowledge', content.slice(0, 30) + (content.length > 30 ? '...' : ''), `查询了关于"${content.slice(0, 50)}"的内容`);
    } catch (err) {
      addMessage(activeConv.id, {
        role: 'assistant',
        content: '抱歉，查询时出现了错误。请稍后重试。',
      });
    } finally {
      setLoading(false);
    }
  }, [activeConv, addMessage, addRecord]);

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

  // 右侧引用面板:优先取当前会话最后一条 assistant 消息的引用(会话切换/刷新后不回退),流式中回退到 allReferences
  const panelReferences = useMemo(() => {
    const msgs = activeConv?.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "assistant" && m.references?.length) return m.references as Reference[];
    }
    return allReferences;
  }, [activeConv?.messages, allReferences]);

  const handleReferenceClick = useCallback((refId: number) => {
    setHighlightedRef(prev => prev === refId ? null : refId);
    // Scroll to source in right panel
    const el = document.getElementById(`source-${refId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const handleNewConversation = () => {
    setAllReferences([]);
    setHighlightedRef(null);
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
      <aside className="w-64 bg-white border-r border-[var(--color-border)] flex flex-col shrink-0">
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
                知识库问答
              </h2>
              <p className="text-sm text-[var(--color-text-secondary)] mb-6 max-w-md">
                基于课程教材、案例和文献的统一知识库，AI 精准回答并标注引用来源
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

        <div className="flex flex-wrap gap-2 mb-3">
            {["海绵城市的核心技术有哪些？","暴雨重现期怎么确定？","SWMM模型的主要功能是什么？","LID设施的径流削减效果如何？"].map(q => (
              <button key={q} onClick={() => handleSend(q)} disabled={loading} className="text-xs px-3 py-1.5 bg-blue-50 text-[var(--color-primary)] rounded-full hover:bg-blue-100 transition-colors disabled:opacity-50">{q}</button>
            ))}
          </div>
          <ChatInput onSend={handleSend} disabled={loading} placeholder="输入课程知识相关问题..." />
      </div>

      {/* Right: Source Panel */}
      <aside
        ref={sourcePanelRef}
        className="w-80 bg-white border-l border-[var(--color-border)] flex flex-col shrink-0 overflow-y-auto"
      >
        <div className="p-4 border-b border-[var(--color-border)] sticky top-0 bg-white z-10">
          <h3 className="text-sm font-bold text-[var(--color-text)]">
            📖 引用来源
          </h3>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
            点击回答中的引用标记查看详情
          </p>
        </div>

        <div className="flex-1 p-3 space-y-2">
          {panelReferences.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-3xl mb-2">📭</div>
              <p className="text-xs text-[var(--color-text-muted)]">
                暂无引用来源
              </p>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                提问后将在此显示引用的文档来源
              </p>
            </div>
          ) : (
            panelReferences.map((ref: Reference) => (
              <div key={ref.id} id={`source-${ref.id}`}>
                <SourceCard
                  reference={ref}
                  isHighlighted={highlightedRef === ref.id}
                  onClick={() => handleReferenceClick(ref.id)}
                />
              </div>
            ))
          )}
        </div>
      </aside>
      {quizOpen && <QuizPanel questions={quizQuestions} onClose={() => setQuizOpen(false)} onComplete={() => setQuizOpen(false)} />}
    </div>
  );
}
