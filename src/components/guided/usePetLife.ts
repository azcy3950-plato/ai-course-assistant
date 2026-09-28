"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WenshuiMood } from './WenshuiAvatar';

type Reaction = {mood: WenshuiMood; line: string; serial: number};
type LearningEvent = {id: string; kind: 'question' | 'complete'} | null;
const moodLines: Partial<Record<WenshuiMood, string>> = {
  idle: '我在这里，陪你慢慢学。', reading: '你看你的，我也翻两页。', thinking: '容我想一想…',
  sleeping: '眯一小会儿。你叫我，我就醒。', walking: '活动活动筋骨，很快回来。', carried: '轻一点，我的书还在手里呢。',
};

/** Small, local reactions; ambient companionship never calls the AI or changes the page. */
export function usePetLife(account: string | null, open: boolean, busy: boolean, dragging: boolean, walking: boolean, learningEvent: LearningEvent) {
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [ambient, setAmbient] = useState<WenshuiMood>('idle');
  const [sleeping, setSleeping] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  const [look, setLook] = useState({x: 0, y: 0});
  const serial = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivity = useRef(Date.now());
  const lastLearningEvent = useRef<string | null>(null);
  const accountRef = useRef(account);
  accountRef.current = account;

  const react = useCallback((mood: WenshuiMood, line: string, duration = 4500) => {
    if (timer.current) clearTimeout(timer.current);
    lastActivity.current = Date.now();
    setReaction({mood, line, serial: ++serial.current});
    timer.current = setTimeout(() => { setReaction(null); timer.current = null; }, duration);
  }, []);
  const stopReaction = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setReaction(null);
    setLook({x: 0, y: 0});
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    stopReaction();
    setSleeping(false); setAmbient('idle');
    lastLearningEvent.current = null;
    let savedQuiet = false;
    try { savedQuiet = !!account && localStorage.getItem(`${account}:quiet`) === '1'; } catch { /* Optional preference. */ }
    setQuiet(savedQuiet);
    if (account && !savedQuiet) react('wave', '你来了。今天也一起慢慢学。', 4500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [account, react, stopReaction]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(media.matches);
    const updateVisibility = () => { setVisible(!document.hidden); lastActivity.current = Date.now(); };
    updateMotion(); updateVisibility();
    media.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    const activity = () => { lastActivity.current = Date.now(); };
    document.addEventListener('keydown', activity);
    document.addEventListener('pointerdown', activity);
    return () => {
      media.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
      document.removeEventListener('keydown', activity);
      document.removeEventListener('pointerdown', activity);
    };
  }, []);
  useEffect(() => {
    if (!account || !visible || open || busy || dragging || walking || sleeping) return;
    if (quiet || reducedMotion) { setAmbient('reading'); return; }
    let step = 0;
    const interval = setInterval(() => {
      const reading = Date.now() - lastActivity.current < 8000;
      setAmbient(reading ? 'reading' : (['reading', 'idle', 'tea', 'reading', 'idle'] as WenshuiMood[])[step++ % 5]);
    }, 16000);
    return () => clearInterval(interval);
  }, [account, visible, open, busy, dragging, walking, sleeping, quiet, reducedMotion]);
  useEffect(() => {
    if (!learningEvent) { lastLearningEvent.current = null; return; }
    if (lastLearningEvent.current === learningEvent.id) return;
    const hadEvent = lastLearningEvent.current !== null;
    lastLearningEvent.current = learningEvent.id;
    // A restored completion is not a new achievement; a first question can be welcomed.
    if ((!hadEvent && learningEvent.kind === 'complete') || quiet || sleeping || dragging || !visible) return;
    if (learningEvent.kind === 'complete') react('celebrate', '这一轮想通了！给认真思考的你鼓个掌。');
    else react('reading', '我在听，咱们一起琢磨。', 3500);
  }, [learningEvent, quiet, sleeping, dragging, visible, react]);

  const toggleQuiet = () => {
    const next = !quiet;
    setQuiet(next); stopReaction(); setAmbient(next ? 'reading' : 'idle');
    try { if (account && accountRef.current === account) localStorage.setItem(`${account}:quiet`, next ? '1' : '0'); } catch { /* In-memory quiet mode still works. */ }
  };
  const toggleSleep = () => {
    stopReaction();
    if (sleeping) { setSleeping(false); react('wave', '醒啦。你刚才学到哪儿了？'); }
    else { setSleeping(true); setAmbient('idle'); }
  };
  const wake = () => { if (sleeping) { setSleeping(false); react('wave', '嗯？我在呢。'); } };
  const trackPointer = (dx: number, dy: number) => {
    if (quiet || sleeping || dragging || reducedMotion) return;
    setLook({x: Math.max(-3, Math.min(3, dx * .07)), y: Math.max(-2, Math.min(2, dy * .05))});
  };
  const mood: WenshuiMood = dragging ? 'carried' : sleeping ? 'sleeping' : walking ? 'walking' : busy ? 'thinking' : reaction?.mood || (open ? 'idle' : ambient);
  const line = dragging || sleeping || walking || busy ? moodLines[mood]! : reaction?.line || (quiet ? '我安静翻书，你专心就好。' : moodLines[mood] || moodLines.idle!);
  return {mood, line, sleeping, quiet, reducedMotion, visible, look, serial: reaction?.serial || 0, bubble: !!reaction && !open && !dragging && !walking && !sleeping && !busy && visible, react, stopReaction, toggleQuiet, toggleSleep, wake, trackPointer, resetLook: () => setLook({x: 0, y: 0})};
}
