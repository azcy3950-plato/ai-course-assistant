'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '@/contexts/AppContext';
import { useLearning } from '@/contexts/LearningContext';
import {
  startGuidedScenario,
  evaluateGuidedAnswer,
  getHint,
} from '@/services/agent';
import { guidedScenarios } from '@/data/guided-scenarios';
import ChatInput from '@/components/ChatInput';
import HintButton from '@/components/HintButton';
import { Message } from '@/types';

interface GuidedMessage extends Message {
  isHint?: boolean;
}

export default function GuidedPage() {
  const { state: appState } = useApp();
  const { state: learningState, startGuided, updateProgress, completeGuided } = useLearning();

  const [messages, setMessages] = useState<GuidedMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [totalSteps, setTotalSteps] = useState(5);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [showScenarioSelect, setShowScenarioSelect] = useState(true);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const maxHints = 3;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = useCallback((msg: Omit<GuidedMessage, 'id' | 'timestamp'>) => {
    const fullMsg: GuidedMessage = {
      ...msg,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, fullMsg]);
  }, []);

  const handleSelectScenario = useCallback(async (id: string) => {
    setShowScenarioSelect(false);
    setMessages([]);
    setHintsUsed(0);
    setIsComplete(false);
    setScenarioId(id);

    setLoading(true);
    try {
      const response = await startGuidedScenario(id);
      const scenario = guidedScenarios.find(s => s.id === id)!;

      setCurrentStep(response.step);
      setTotalSteps(response.totalSteps);

      addMessage({ role: 'assistant', content: response.greeting });
      addMessage({ role: 'assistant', content: response.firstQuestion });

      startGuided(id, scenario.title, response.totalSteps);
    } catch {
      addMessage({ role: 'assistant', content: '启动引导场景失败，请重试。' });
    } finally {
      setLoading(false);
    }
  }, [addMessage, startGuided]);

  const handleAnswer = useCallback(async (answer: string) => {
    if (!scenarioId || isComplete) return;

    addMessage({ role: 'user', content: answer });
    setLoading(true);

    try {
      const result = await evaluateGuidedAnswer(scenarioId, currentStep, answer);

      addMessage({ role: 'assistant', content: result.feedback });

      if (result.isComplete) {
        setIsComplete(true);
        addMessage({
          role: 'assistant',
          content: '🎉 恭喜你完成了本轮引导学习！你对这个主题有了更深入的理解。\n\n你可以选择其他场景继续学习，或者回顾刚才的对话内容。',
        });
        completeGuided();
        updateProgress({ currentStep: totalSteps });
      } else if (result.nextQuestion) {
        const nextStep = currentStep + 1;
        setCurrentStep(nextStep);
        updateProgress({ currentStep: nextStep });

        // Brief pause before next question
        setTimeout(() => {
          addMessage({ role: 'assistant', content: result.nextQuestion! });
        }, 1500);
      }
    } catch {
      addMessage({ role: 'assistant', content: '评估回答时出现错误，请重试。' });
    } finally {
      setLoading(false);
    }
  }, [scenarioId, currentStep, isComplete, addMessage, completeGuided, updateProgress]);

  const handleHint = useCallback(async (): Promise<string> => {
    if (!scenarioId) return '';

    const hint = await getHint(scenarioId, currentStep, hintsUsed);
    const newHintsUsed = hintsUsed + 1;
    setHintsUsed(newHintsUsed);
    updateProgress({ hintsUsed: newHintsUsed });

    addMessage({ role: 'assistant', content: `💡 **提示 ${newHintsUsed}**：${hint}`, isHint: true });
    return hint;
  }, [scenarioId, currentStep, hintsUsed, addMessage, updateProgress]);

  const handleSkip = useCallback(() => {
    if (!scenarioId || isComplete) return;

    addMessage({ role: 'user', content: '（暂时不会，先跳过）' });
    setLoading(true);

    evaluateGuidedAnswer(scenarioId, currentStep, 'SKIP')
      .then(result => {
        addMessage({ role: 'assistant', content: '好的，没关系！让我们看看这个问题的解答：\n\n' + result.explanation });

        if (result.isComplete) {
          setIsComplete(true);
          addMessage({
            role: 'assistant',
            content: '🎉 虽然有些问题跳过了，但你坚持完成了整个引导过程。建议之后回顾一下跳过的内容。',
          });
          completeGuided();
          updateProgress({ currentStep: totalSteps });
        } else if (result.nextQuestion) {
          const nextStep = currentStep + 1;
          setCurrentStep(nextStep);
          updateProgress({ currentStep: nextStep });
          setTimeout(() => {
            addMessage({ role: 'assistant', content: result.nextQuestion! });
          }, 1500);
        }
      })
      .catch(() => {
        addMessage({ role: 'assistant', content: '操作出错，请重试。' });
      })
      .finally(() => setLoading(false));
  }, [scenarioId, currentStep, isComplete, addMessage, completeGuided, updateProgress]);

  const handleReset = () => {
    setShowScenarioSelect(true);
    setMessages([]);
    setHintsUsed(0);
    setCurrentStep(1);
    setIsComplete(false);
    setScenarioId(null);
  };

  const progressPercent = Math.round((currentStep / totalSteps) * 100);

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Scenario Selection */}
        {showScenarioSelect ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="max-w-2xl w-full px-6 text-center">
              <div className="text-5xl mb-4">💡</div>
              <h2 className="text-2xl font-bold text-[var(--color-text)] mb-2">
                引导学习
              </h2>
              <p className="text-sm text-[var(--color-text-secondary)] mb-8">
                AI 将通过多轮提问引导你深入思考，逐步掌握专业知识。
                选择一个主题开始吧！
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                {guidedScenarios.map(scenario => (
                  <button
                    key={scenario.id}
                    onClick={() => handleSelectScenario(scenario.id)}
                    disabled={loading}
                    className="p-5 bg-white border border-[var(--color-border)] rounded-xl hover:border-[var(--color-primary)] hover:shadow-md transition-all text-left disabled:opacity-50"
                  >
                    <h3 className="font-bold text-[var(--color-text)] mb-1.5">
                      {scenario.title}
                    </h3>
                    <p className="text-xs text-[var(--color-text-secondary)] mb-3">
                      {scenario.description}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                      <span className="px-2 py-0.5 rounded-full bg-gray-100">
                        {scenario.steps.length} 轮对话
                      </span>
                      <span>{Math.ceil(scenario.steps.length * 3)} 分钟预计</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="max-w-3xl mx-auto">
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 py-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm ${
                        msg.role === 'user'
                          ? 'bg-[var(--color-primary)] text-white'
                          : msg.isHint
                          ? 'bg-amber-100 text-amber-600'
                          : 'bg-[var(--color-accent)] text-white'
                      }`}
                    >
                      {msg.role === 'user' ? 'U' : msg.isHint ? '💡' : 'AI'}
                    </div>
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-[var(--color-primary)] text-white'
                          : msg.isHint
                          ? 'bg-amber-50 border border-amber-200 text-amber-900'
                          : 'bg-white border border-[var(--color-border)] text-[var(--color-text)]'
                      }`}
                    >
                      <div className="message-content whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-4">
                    <span className="animate-spin">⏳</span> AI 正在思考...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            </div>

            {/* Input Area */}
            <div className="border-t border-[var(--color-border)] bg-white">
              <div className="flex items-center gap-2 px-4 py-2 max-w-3xl mx-auto">
                <HintButton
                  onHint={handleHint}
                  hintsUsed={hintsUsed}
                  maxHints={maxHints}
                  disabled={loading || isComplete}
                />
                <button
                  onClick={handleSkip}
                  disabled={loading || isComplete}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-[var(--color-text-secondary)] hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ⏭ 暂时不会
                </button>
                {isComplete && (
                  <button
                    onClick={handleReset}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] text-white hover:bg-emerald-700 transition-colors"
                  >
                    🔄 选择新场景
                  </button>
                )}
              </div>
              {!isComplete && (
                <ChatInput
                  onSend={handleAnswer}
                  disabled={loading}
                  placeholder={`第 ${currentStep}/${totalSteps} 轮 — 输入你的回答...`}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Right: Progress Panel */}
      {!showScenarioSelect && (
        <aside className="w-72 bg-white border-l border-[var(--color-border)] flex flex-col shrink-0 overflow-y-auto p-5">
          <h3 className="text-sm font-bold text-[var(--color-text)] mb-5">
            📊 学习进度
          </h3>

          {/* Progress Ring */}
          <div className="flex justify-center mb-5">
            <div className="relative w-28 h-28">
              <svg className="w-28 h-28 -rotate-90" viewBox="0 0 120 120">
                <circle
                  cx="60" cy="60" r="52"
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="8"
                />
                <circle
                  cx="60" cy="60" r="52"
                  fill="none"
                  stroke={isComplete ? '#059669' : '#2563eb'}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${progressPercent * 3.27} 327`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-[var(--color-text)]">
                  {progressPercent}%
                </span>
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {isComplete ? '已完成' : '进行中'}
                </span>
              </div>
            </div>
          </div>

          {/* Step Info */}
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[10px] text-[var(--color-text-muted)] mb-1">当前轮次</div>
              <div className="text-lg font-bold text-[var(--color-text)]">
                {currentStep} / {totalSteps}
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[10px] text-[var(--color-text-muted)] mb-1">已用提示</div>
              <div className="text-lg font-bold text-[var(--color-text)]">
                {hintsUsed} / {maxHints}
              </div>
              {hintsUsed >= maxHints && (
                <div className="text-[10px] text-[var(--color-danger)] mt-1">
                  提示次数已用完
                </div>
              )}
            </div>

            {scenarioId && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-[10px] text-[var(--color-text-muted)] mb-1">学习场景</div>
                <div className="text-sm font-medium text-[var(--color-text)]">
                  {guidedScenarios.find(s => s.id === scenarioId)?.title}
                </div>
              </div>
            )}
          </div>

          {/* Tips */}
          <div className="mt-auto pt-5">
            <div className="text-[10px] text-[var(--color-text-muted)] leading-relaxed bg-blue-50 rounded-lg p-3">
              <strong>💡 提示：</strong>即使不确定答案，也请尝试回答。思考的过程比正确答案更重要！每轮最多使用 {maxHints} 次提示。
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
