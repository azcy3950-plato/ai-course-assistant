'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '@/contexts/AppContext';
import { useLearning } from '@/contexts/LearningContext';
import ChatInput from '@/components/ChatInput';
import { Message } from '@/types';

interface GuidedMessage extends Message {
  isHint?: boolean;
}

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("aicourse-token") || "";
}

async function callAgent(action: string, params: Record<string, any>) {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
    body: JSON.stringify({ action, params }),
  });
  if (!res.ok) throw new Error("AI error");
  return res.json();
}

export default function GuidedPage() {
  const { state: appState } = useApp();
  const { startGuided, updateProgress, completeGuided } = useLearning();

  const [messages, setMessages] = useState<GuidedMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);
  const maxHints = 4;

  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const addMsg = useCallback((role: 'user'|'assistant', content: string, isHint=false) => {
    setMessages(prev => [...prev, { role, content, isHint, id: Date.now().toString(36)+Math.random().toString(36).slice(2,8), timestamp: Date.now() }]);
  }, []);

  // Start with student's free question
  const handleStart = useCallback(async (question: string) => {
    setActive(true);
    addMsg('user', question);
    setLoading(true);
    startGuided('free', '自由引导', 8);
    try {
      const r = await callAgent("guided_free", { question });
      addMsg('assistant', r.greeting || "好的，让我来引导你思考这个问题。");
    } catch { addMsg('assistant', '启动失败，请重试。'); }
    finally { setLoading(false); }
  }, [addMsg, startGuided]);

  // Student answers → AI responds with guidance
  const handleSend = useCallback(async (text: string) => {
    if (loading) return;
    addMsg('user', text);
    setLoading(true);
    try {
      const r = await callAgent("guided_free_turn", {
        history: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
        answer: text,
      });
      addMsg('assistant', r.response);
      updateProgress({ currentStep: messages.length + 1 });
    } catch { addMsg('assistant', '抱歉，出错了。请重试。'); }
    finally { setLoading(false); }
  }, [loading, messages, addMsg, updateProgress]);

  // Hint
  const handleHint = useCallback(async () => {
    if (hintsUsed >= maxHints) return;
    setLoading(true);
    try {
      const r = await callAgent("guided_free_hint", {
        history: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
        level: hintsUsed + 1,
      });
      setHintsUsed(h => h + 1);
      addMsg('assistant', `💡 **提示 ${hintsUsed+1}/${maxHints}**：${r.hint}`, true);
    } catch { addMsg('assistant', '获取提示失败。'); }
    finally { setLoading(false); }
  }, [hintsUsed, messages, addMsg]);

  const handleReset = () => { setActive(false); setMessages([]); setHintsUsed(0); };

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <div className="flex-1 flex flex-col min-w-0">
        {!active ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="max-w-2xl w-full px-6 text-center">
              <div className="text-5xl mb-4">💡</div>
              <h2 className="text-2xl font-bold text-[var(--color-text)] mb-2">引导学习</h2>
              <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                AI 不会直接给你答案，而是通过提问引导你自己思考。<br/>
                输入你困惑的问题，AI 会一步步带你找到答案。
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-left text-sm text-amber-800">
                <strong>📋 规则：</strong>
                <ul className="mt-2 space-y-1 text-xs">
                  <li>• AI 不会直接回答，会用提问引导你思考</li>
                  <li>• 每次只问一个问题，循序渐进</li>
                  <li>• 可以随时请求提示（最多{maxHints}次）</li>
                  <li>• 也可以输入新问题切换方向</li>
                </ul>
              </div>
              <ChatInput onSend={handleStart} disabled={loading}
                placeholder="输入你想探讨的问题，例如：为什么海绵城市能减少内涝？" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="max-w-3xl mx-auto">
                {messages.map(msg => (
                  <div key={msg.id} className={`flex gap-3 py-3 ${msg.role==='user'?'flex-row-reverse':''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm ${
                      msg.role==='user'?'bg-[var(--color-primary)] text-white'
                      :msg.isHint?'bg-amber-100 text-amber-600':'bg-[var(--color-accent)] text-white'}`}>
                      {msg.role==='user'?'U':msg.isHint?'💡':'AI'}
                    </div>
                    <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role==='user'?'bg-[var(--color-primary)] text-white'
                      :msg.isHint?'bg-amber-50 border border-amber-200 text-amber-900'
                      :'bg-white border border-[var(--color-border)] text-[var(--color-text)]'}`}>
                      <div className="message-content whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                ))}
                {loading && <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-4">
                  <span className="animate-spin">⏳</span> AI 正在思考...</div>}
                <div ref={chatEndRef}/>
              </div>
            </div>
            <div className="border-t border-[var(--color-border)] bg-white px-4 py-2 flex items-center gap-2">
              <button onClick={handleHint} disabled={loading || hintsUsed>=maxHints}
                className="px-3 py-2 rounded-lg text-sm font-medium border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-40 transition-colors">
                💡 提示 ({hintsUsed}/{maxHints})
              </button>
              <button onClick={handleReset}
                className="px-3 py-2 rounded-lg text-sm border border-gray-300 text-gray-500 hover:bg-gray-50 transition-colors">
                🔄 重新开始
              </button>
              <div className="flex-1">
                <ChatInput onSend={handleSend} disabled={loading}
                  placeholder="输入你的回答或新问题..." />
              </div>
            </div>
          </>
        )}
      </div>

      {active && (
        <aside className="w-64 bg-white border-l border-[var(--color-border)] flex flex-col shrink-0 p-4">
          <h3 className="text-sm font-bold text-[var(--color-text)] mb-4">📊 学习状态</h3>
          <div className="bg-gray-50 rounded-lg p-3 mb-3">
            <div className="text-[10px] text-[var(--color-text-muted)]">对话轮次</div>
            <div className="text-lg font-bold">{messages.filter(m=>m.role==='user').length}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 mb-3">
            <div className="text-[10px] text-[var(--color-text-muted)]">已用提示</div>
            <div className="text-lg font-bold">{hintsUsed} / {maxHints}</div>
          </div>
          <div className="mt-auto pt-4 text-[10px] text-[var(--color-text-muted)] bg-blue-50 rounded-lg p-3">
            <strong>💡</strong> 即使不确定，也请尝试回答。思考过程比答案更重要！
          </div>
        </aside>
      )}
    </div>
  );
}
