"use client";

import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAuthToken } from "@/contexts/AppContext";

interface QuizQuestion {
  question: string;
  options: string[];
  correct: string;
  explanation: string;
  topic: string;
}

interface Props {
  questions: QuizQuestion[];
  onClose: () => void;
  onComplete: (results: { correct: number; total: number }) => void;
}

export default function QuizPanel({ questions, onClose, onComplete }: Props) {
  const [current, setCurrent] = useState(0);
  const [answered, setAnswered] = useState<Record<number, string>>({});
  const [showResult, setShowResult] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const q = questions[current];
  const allAnswered = Object.keys(answered).length >= questions.length;

  const selectOption = (letter: string) => {
    if (submitted) return;
    setAnswered((prev) => ({ ...prev, [current]: letter }));
  };

  const submit = async () => {
    if (!allAnswered) return;
    setSubmitted(true);
    let correct = 0;
    for (let i = 0; i < questions.length; i++) {
      const isCorrect = answered[i] === questions[i].correct;
      if (isCorrect) correct++;
      try {
        const { data: session } = await supabase.auth.getSession();
        const email = session?.session?.user?.email || "unknown";
        await fetch("/api/quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
          body: JSON.stringify({
            question: questions[i].question,
            student_answer: answered[i] || "",
            correct_answer: questions[i].correct,
            is_correct: isCorrect,
            topic: questions[i].topic,
          }),
        });
      } catch (e) {}
    }
    setShowResult(true);
    onComplete({ correct, total: questions.length });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[var(--color-border)] w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-base font-bold">📝 阶段检测 {showResult ? "结果" : `(${current + 1}/${questions.length})`}</h3>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">✕</button>
        </div>

        <div className="p-6">
          {!showResult ? (
            <>
              <p className="text-sm mb-4">{q.question}</p>
              <div className="space-y-2 mb-6">
                {q.options.map((opt) => {
                  const letter = opt.trim().charAt(0);
                  return (
                    <button
                      key={letter}
                      onClick={() => selectOption(letter)}
                      className={"w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors " +
                        (answered[current] === letter
                          ? "border-[var(--color-primary)] bg-[var(--color-primary-bg)] text-[var(--color-primary)]"
                          : "border-[var(--color-border)] hover:border-gray-400")}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-between">
                <button
                  onClick={() => setCurrent(Math.max(0, current - 1))}
                  disabled={current === 0}
                  className="px-4 py-2 text-sm border rounded-lg disabled:opacity-30"
                >
                  上一题
                </button>
                <button
                  onClick={() => setCurrent(Math.min(questions.length - 1, current + 1))}
                  disabled={current === questions.length - 1}
                  className="px-4 py-2 text-sm border rounded-lg disabled:opacity-30"
                >
                  下一题
                </button>
              </div>
              <button
                onClick={submit}
                disabled={!allAnswered || submitted}
                className="mt-4 w-full py-3 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-[var(--color-primary-dark)]"
              >
                {allAnswered ? "提交答案" : `还有 ${questions.length - Object.keys(answered).length} 题未答`}
              </button>
            </>
          ) : (
            <div>
              <div className="text-center mb-6">
                <div className="text-5xl mb-3">
                  {Object.keys(answered).filter((k) => answered[parseInt(k)] === questions[parseInt(k)].correct).length >= questions.length / 2 ? "🎉" : "💪"}
                </div>
                <div className="text-2xl font-bold">
                  {Object.keys(answered).filter((k) => answered[parseInt(k)] === questions[parseInt(k)].correct).length} / {questions.length} 正确
                </div>
              </div>
              <div className="space-y-4">
                {questions.map((q, i) => {
                  const isCorrect = answered[i] === q.correct;
                  return (
                    <div key={i} className={"p-4 rounded-lg " + (isCorrect ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200")}>
                      <div className="flex items-center gap-2 mb-1">
                        <span>{isCorrect ? "✅" : "❌"}</span>
                        <span className="text-sm font-medium">{q.question}</span>
                      </div>
                      <div className="text-xs mt-1">
                        你的答案：{answered[i]} · 正确答案：{q.correct}
                      </div>
                      <div className="text-xs mt-2 text-[var(--color-text-secondary)]">{q.explanation}</div>
                    </div>
                  );
                })}
              </div>
              <button onClick={onClose} className="mt-6 w-full py-3 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium">
                继续学习
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
