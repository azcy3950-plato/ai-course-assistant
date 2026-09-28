"use client";

import { useEffect, useRef, useState } from 'react';
import { BookOpen, Lightbulb, PencilLine, Send } from 'lucide-react';
import { getAuthToken } from '@/contexts/AppContext';
import { useCompanionSnapshot } from '@/contexts/CompanionContext';
import { parseCompanionQuiz, type CompanionMode, type CompanionQuiz } from '@/lib/mentor/companion';
import styles from './floating-wenshui-pet.module.css';

type Entry = {id: number; label: string; text?: string; quiz?: CompanionQuiz; selected?: number; source: string; rewardKey: string; rewarded?: boolean};
type Request = {mode: CompanionMode; message?: string};
const labels = {hint: '给我提示', explain: '讲解一下', quiz: '出道练习', chat: '问问先生'};

export function usePetLearning(account: string | null, onCorrect: (key: string) => boolean, onAnswer?: (correct: boolean) => void) {
  const snapshot = useCompanionSnapshot();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastRequest, setLastRequest] = useState<Request | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const answered = useRef(new Set<number>());
  const feedRef = useRef<HTMLDivElement>(null);
  const contextKey = `${account}|${snapshot.nodeId}|${snapshot.question}`;
  const contextRef = useRef(contextKey);
  contextRef.current = contextKey;
  useEffect(() => {
    sequence.current++;
    requestRef.current?.abort(); requestRef.current = null;
    setBusy(false); setError(''); setEntries([]); setLastRequest(null);
    answered.current.clear();
    return () => { sequence.current++; requestRef.current?.abort(); requestRef.current = null; };
  }, [contextKey]);
  useEffect(() => { setDraft(''); }, [account]);
  useEffect(() => {
    // Scroll only the pet's own message list, never the page behind it.
    const feed = feedRef.current;
    if (!feed) return;
    const last = feed.querySelector('article:last-of-type');
    const target = last?.querySelector('[role="status"]') || last;
    if (busy || error) feed.scrollTop = feed.scrollHeight;
    else if (target) feed.scrollTop += target.getBoundingClientRect().top - feed.getBoundingClientRect().top - 3;
  }, [entries, busy, error]);

  const request = async (mode: CompanionMode, message = '') => {
    if (!account || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const id = ++sequence.current;
    const startedContext = contextKey;
    const stillCurrent = () => sequence.current === id && contextRef.current === startedContext;
    setBusy(true); setError(''); setLastRequest({mode, message});
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60000);
    try {
      const previousQuestion = [...entries].reverse().find(entry => entry.quiz)?.quiz?.question;
      const ownHistory = entries.slice(-3).flatMap(entry => [{role: 'user', content: entry.label}, {role: 'assistant', content: entry.text || (entry.quiz ? `${entry.quiz.question}\n${entry.quiz.options.map((option, i) => `${'ABCD'[i]}. ${option}`).join('\n')}${entry.selected !== undefined ? `\n学生已选${'ABCD'[entry.selected]}；解析：${entry.quiz.explanation}` : '\n学生尚未作答，请先引导思考。'}` : '')}]);
      const response = await fetch('/api/agent', {
        method: 'POST', signal: controller.signal,
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}`},
        body: JSON.stringify({action: 'pet_companion', params: {mode, message, nodeId: snapshot.nodeId, question: snapshot.question, history: [...snapshot.history.slice(-4), ...ownHistory].slice(-8), previousQuestion}}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录后再试。' : data.error || '暂时没有连接上先生，请重试。');
      const quiz = mode === 'quiz' ? parseCompanionQuiz(data.quiz) : null;
      if (mode === 'quiz' ? !quiz : typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('回答没有接收完整，请重试。');
      if (!stillCurrent()) return;
      setEntries(old => [...old.slice(-7), {id, label: mode === 'chat' ? message : labels[mode], text: mode === 'quiz' ? undefined : data.answer, quiz: quiz || undefined, source: data.source?.name || snapshot.nodeName, rewardKey: `quiz:${data.source?.id || snapshot.nodeId}:${quiz?.question || ''}`}]);
      if (mode === 'chat') setDraft(old => old.trim() === message ? '' : old);
    } catch (cause) {
      if (stillCurrent()) setError(timedOut ? '先生想得有点久，请重试一次。' : controller.signal.aborted ? '已停止，你可以重新提问。' : cause instanceof Error ? cause.message : '连接中断，请重试。');
    } finally {
      window.clearTimeout(timer);
      if (stillCurrent()) { requestRef.current = null; setBusy(false); }
    }
  };
  const choose = (entry: Entry, choice: number) => {
    if (!entry.quiz || answered.current.has(entry.id)) return;
    answered.current.add(entry.id);
    const rewarded = choice === entry.quiz.correct && onCorrect(entry.rewardKey);
    onAnswer?.(choice === entry.quiz.correct);
    setEntries(old => old.map(item => item.id === entry.id ? {...item, selected: choice, rewarded} : item));
  };
  const hasContext = !!(snapshot.nodeId || snapshot.question);
  const content = <>
    <div className={styles.context} data-testid="pet-learning-context"><span>正在陪你学</span><strong>{snapshot.nodeName || '从一个问题开始'}</strong>{snapshot.question && <small title={snapshot.question}>{snapshot.question}</small>}</div>
    <div className={styles.studyActions}>
      <button type="button" disabled={busy || !hasContext} onClick={() => void request('hint')}><Lightbulb size={15}/>给我提示</button>
      <button type="button" disabled={busy || !hasContext} onClick={() => void request('explain')}><BookOpen size={15}/>讲解一下</button>
      <button type="button" disabled={busy || !hasContext} onClick={() => void request('quiz')}><PencilLine size={15}/>出道练习</button>
    </div>
    <div ref={feedRef} className={styles.feed} aria-label="宠物陪学记录" aria-busy={busy}>
      {!entries.length && !busy && <p className={styles.empty}>{hasContext ? '卡住了就点“给我提示”，想巩固就做道小练习。也可以直接在下面问我。' : '在图谱中选择一个知识点，或直接在下面告诉我想学什么。'}</p>}
      {entries.map(entry => <article key={entry.id} className={styles.reply}>
        <small className={styles.replyLabel}>{entry.label}</small>
        {entry.text && <p>{entry.text}</p>}
        {entry.quiz && <div data-testid="pet-quiz">
          <p className={styles.quizQuestion}>{entry.quiz.question}</p>
          <div className={styles.options}>{entry.quiz.options.map((option, index) => <button type="button" key={index} disabled={entry.selected !== undefined} className={entry.selected !== undefined ? index === entry.quiz!.correct ? styles.correct : index === entry.selected ? styles.incorrect : '' : ''} onClick={() => choose(entry, index)}><b>{'ABCD'[index]}.</b>{option}</button>)}</div>
          {entry.selected !== undefined && <div className={styles.feedback} role="status"><strong>{entry.selected === entry.quiz.correct ? `答对了！${entry.rewarded ? '伙伴经验 +10' : '这个知识点再巩固一次。'}` : `再看一看：正确答案是 ${'ABCD'[entry.quiz.correct]}。`}</strong><p>{entry.quiz.explanation}</p><button type="button" disabled={busy} onClick={() => void request('quiz')}>再来一题</button></div>}
        </div>}
        {entry.source && <small className={styles.source}>知识点：{entry.source}</small>}
      </article>)}
      {busy && <div className={styles.pending} role="status">先生正在结合课程资料思考…<button type="button" onClick={() => requestRef.current?.abort()}>停止</button></div>}
      {error && <div className={styles.error} role="alert">{error}{lastRequest && <button type="button" onClick={() => void request(lastRequest.mode, lastRequest.message)}>重试</button>}</div>}
    </div>
    <form className={styles.ask} onSubmit={event => { event.preventDefault(); if (draft.trim()) void request('chat', draft.trim()); }}>
      <input aria-label="向问水先生提问" placeholder="还没懂？在这里问先生…" value={draft} maxLength={1000} onChange={event => setDraft(event.target.value)}/>
      <button type="submit" aria-label="发送给问水先生" disabled={busy || !draft.trim()}><Send size={16}/></button>
    </form>
  </>;
  return {content, busy};
}
