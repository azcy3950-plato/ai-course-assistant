"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpRight, BookOpen, Coffee, Footprints, Hand, Heart, Moon, RotateCcw, Sparkles, Sun, VolumeX, X } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useCompanionSnapshot } from '@/contexts/CompanionContext';
import { accountStorageKey } from '@/lib/mentor/course';
import { applyPetAction, celebratePetStep, emptyPetState, petBondLabel, PET_LEVEL_XP, restorePetState, type PetAction, type PetState } from '@/lib/mentor/pet';
import { boundPet, defaultPetPosition, petSizeFor, petWalkTarget, type PetPosition, type PetViewport } from '@/lib/mentor/pet-placement';
import { usePetLearning } from './usePetLearning';
import { usePetLife } from './usePetLife';
import WenshuiAvatar from './WenshuiAvatar';
import styles from './floating-wenshui-pet.module.css';

const POSITION_PREFIX = 'wenshui-pet-position-v1';
const STATE_PREFIX = 'wenshui-pet-state-v1';
type Drag = {pointerId: number; x: number; y: number; origin: PetPosition; moved: boolean};
type View = 'companion' | 'study';
const readViewport = (): PetViewport => ({width: window.innerWidth, height: window.innerHeight});

/** A companion lives above the workspace; it never changes its DOM, layout, or scroll. */
export default function FloatingWenshuiPet() {
  const {state} = useApp();
  const snapshot = useCompanionSnapshot();
  const account = state.authLoading || !state.role ? null : accountStorageKey(STATE_PREFIX);
  const [loadedAccount, setLoadedAccount] = useState<string | null>(null);
  const [viewport, setViewport] = useState<PetViewport>({width: 0, height: 0});
  const [position, setPosition] = useState<PetPosition>({x: 0, y: 0});
  const [pet, setPet] = useState<PetState>(emptyPetState);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('companion');
  const [dragging, setDragging] = useState(false);
  const [walking, setWalking] = useState(false);
  const [warning, setWarning] = useState('');
  const [panelSize, setPanelSize] = useState({width: 304, height: 360});
  const drag = useRef<Drag | null>(null);
  const positionRef = useRef(position);
  const petRef = useRef(pet);
  const suppressClick = useRef(false);
  const handle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const walkFrame = useRef<number | null>(null);
  const lifeRef = useRef<ReturnType<typeof usePetLife> | null>(null);
  const panelId = useId();

  const moveTo = useCallback((next: PetPosition) => { positionRef.current = next; setPosition(next); }, []);
  const stopWalk = useCallback(() => {
    if (walkFrame.current !== null) cancelAnimationFrame(walkFrame.current);
    walkFrame.current = null;
    setWalking(false);
  }, []);
  const savePet = (next: PetState) => {
    if (!account || accountStorageKey(STATE_PREFIX) !== account) return;
    petRef.current = next; setPet(next);
    try { localStorage.setItem(account, JSON.stringify(next)); setWarning(''); }
    catch { setWarning('这次互动暂时无法保存。'); }
  };
  const learning = usePetLearning(account, key => {
    if (!account || accountStorageKey(STATE_PREFIX) !== account) return false;
    const previous = petRef.current;
    const next = celebratePetStep(previous, key);
    if (next === previous) return false;
    savePet(next);
    lifeRef.current?.react('celebrate', next.level > previous.level ? `一起进步，升到 Lv.${next.level} 啦！` : '答对啦！这下可以开心地捋捋胡子了。', 6000);
    return true;
  }, correct => {
    if (!correct) lifeRef.current?.react('thinking', '没关系，错的地方正好值得一起想一想。', 4500);
  });
  const life = usePetLife(account, open, learning.busy, dragging, walking, snapshot.learningEvent);
  lifeRef.current = life;

  useEffect(() => {
    setOpen(false); setView('companion'); setWarning(''); stopWalk();
    drag.current = null; setDragging(false); suppressClick.current = false;
    if (!account) { setLoadedAccount(null); return; }
    const currentViewport = readViewport();
    let restoredPosition = defaultPetPosition(currentViewport);
    let restoredPet = emptyPetState();
    try {
      const key = accountStorageKey(POSITION_PREFIX);
      const saved = key ? JSON.parse(localStorage.getItem(key) || 'null') : null;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) restoredPosition = boundPet(saved, currentViewport);
    } catch { /* A damaged position does not prevent opening the companion. */ }
    try { restoredPet = restorePetState(JSON.parse(localStorage.getItem(account) || 'null')); }
    catch { setWarning('伙伴记录暂时无法读取，本次仍可互动。'); }
    moveTo(restoredPosition); setViewport(currentViewport);
    petRef.current = restoredPet; setPet(restoredPet); setLoadedAccount(account);
    const resize = () => {
      stopWalk();
      const nextViewport = readViewport();
      setViewport(nextViewport); moveTo(boundPet(positionRef.current, nextViewport));
    };
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); stopWalk(); };
  }, [account, moveTo, stopWalk]);
  useEffect(() => { if (!life.visible) stopWalk(); }, [life.visible, stopWalk]);

  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const element = panel.current;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setPanelSize(old => old.width === rect.width && old.height === rect.height ? old : {width: rect.width, height: rect.height});
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [open, view]);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus({preventScroll: true});
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false); handle.current?.focus({preventScroll: true});
    };
    const outside = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!panel.current?.contains(event.target) && !handle.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); };
  }, [open]);

  const savePosition = (next: PetPosition) => {
    if (!account || accountStorageKey(STATE_PREFIX) !== account) return;
    try { const key = accountStorageKey(POSITION_PREFIX); if (key) localStorage.setItem(key, JSON.stringify(next)); }
    catch { setWarning('位置暂时无法保存，刷新后可能恢复默认位置。'); }
  };
  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    stopWalk(); suppressClick.current = false;
    drag.current = {pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: positionRef.current, moved: false};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      life.trackPointer(event.clientX - rect.x - rect.width / 2, event.clientY - rect.y - rect.height / 2);
      return;
    }
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) <= 5) return;
    if (!current.moved) { life.stopReaction(); life.wake(); }
    current.moved = true; setDragging(true); setOpen(false);
    moveTo(boundPet({x: current.origin.x + dx, y: current.origin.y + dy}, readViewport()));
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    suppressClick.current = current.moved || event.type !== 'pointerup';
    drag.current = null; setDragging(false);
    if (current.moved) {
      savePosition(positionRef.current);
      if (event.type === 'pointerup' && !life.quiet) life.react('wave', '站稳啦。这个位置也不错。', 3000);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const close = () => { setOpen(false); handle.current?.focus({preventScroll: true}); };
  const interact = (action: PetAction) => {
    if (!account || accountStorageKey(STATE_PREFIX) !== account) return;
    stopWalk(); life.wake();
    const result = applyPetAction(petRef.current, action); savePet(result.state);
    if (action === 'tea') life.react('tea', result.message, 6500);
    else life.react('petted', ['嘿嘿，胡子都被你摸翘啦。', '嗯，收到！精神又回来了一点。', '老先生也是很喜欢被惦记的。'][petRef.current.interactions % 3], 4200);
  };
  const stroll = () => {
    stopWalk(); life.wake(); close();
    if (life.reducedMotion) { life.react('wave', '伸个懒腰，我就在这里陪你。'); return; }
    life.stopReaction();
    const origin = {...positionRef.current};
    const obstacles = [...document.querySelectorAll('main input, main textarea, main button, main select, [aria-modal="true"]')].map(el => el.getBoundingClientRect()).filter(rect => rect.width && rect.height);
    const target = petWalkTarget(origin, readViewport(), obstacles);
    if (!target) { life.react('wave', '这里有点挤，我先原地活动一下。'); return; }
    setWalking(true);
    const started = performance.now();
    const animate = (now: number) => {
      const elapsed = now - started;
      if (elapsed >= 4400) { moveTo(origin); stopWalk(); if (!life.quiet) life.react('wave', '散步回来，继续陪你。', 3000); return; }
      const phase = elapsed < 2000 ? elapsed / 2000 : elapsed < 2400 ? 1 : 1 - (elapsed - 2400) / 2000;
      const eased = .5 - Math.cos(Math.PI * phase) / 2;
      moveTo({x: origin.x + (target.x - origin.x) * eased, y: origin.y + (target.y - origin.y) * eased});
      walkFrame.current = requestAnimationFrame(animate);
    };
    walkFrame.current = requestAnimationFrame(animate);
  };

  if (!account || loadedAccount !== account || !viewport.width) return null;
  const size = petSizeFor(viewport.width);
  const panelWidth = Math.min(view === 'study' ? 368 : 304, viewport.width - 16);
  const visual = window.visualViewport;
  const visibleTop = visual?.offsetTop || 0;
  const visibleHeight = Math.min(viewport.height, visual?.height || viewport.height);
  const maxPanelHeight = Math.max(180, visibleHeight - 16);
  const height = Math.min(view === 'study' ? 590 : panelSize.height, maxPanelHeight);
  const panelLeft = Math.max(8, Math.min(position.x + size - panelWidth, viewport.width - panelWidth - 8));
  const panelTop = Math.max(visibleTop + 8, Math.min(position.y >= visibleTop + height + 20 ? position.y - height - 8 : position.y + size + 8, visibleTop + visibleHeight - height - 8));
  const bubbleWidth = Math.min(208, viewport.width - 16);
  const bubbleLeft = Math.max(8, Math.min(position.x + size / 2 - bubbleWidth / 2, viewport.width - bubbleWidth - 8));
  const bubbleTop = position.y > 150 ? position.y - 72 : position.y + size + 4;
  const statusLabel = life.sleeping ? '小憩中' : life.quiet ? '安静陪伴' : learning.busy ? '认真思考中' : life.mood === 'reading' ? '翻两页书' : '一直在你身边';

  return createPortal(<>
    <div className={styles.dock} data-testid="wenshui-pet" data-pet-mood={life.mood} data-pet-quiet={life.quiet} style={{left: position.x, top: position.y, width: size, height: size}}>
      <button ref={handle} type="button" className={`${styles.handle} ${dragging ? styles.dragging : ''}`}
        data-testid="wenshui-pet-handle" aria-label="问水先生，点击互动，按方向键移动" aria-expanded={open} aria-controls={open ? panelId : undefined}
        title="点我互动 · 按住拖动" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerLeave={life.resetLook} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
        onClick={event => {
          if (event.detail !== 0 && suppressClick.current) { suppressClick.current = false; return; }
          suppressClick.current = false; stopWalk();
          if (!open) { setView('companion'); if (life.sleeping) life.wake(); else if (!life.quiet) life.react('wave', '在呢。想陪我坐一会儿吗？', 3200); }
          setOpen(value => !value);
        }}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); stopWalk();
          const step = event.shiftKey ? 48 : 24;
          const next = boundPet({x: positionRef.current.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: positionRef.current.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)}, readViewport());
          moveTo(next); savePosition(next);
        }}><WenshuiAvatar key={life.serial} mood={life.mood} size={size} look={life.look} className={life.quiet || !life.visible ? styles.stillAvatar : ''}/></button>
    </div>
    {life.bubble && <div key={life.serial} role="status" className={styles.bubble} data-testid="pet-speech" style={{left: bubbleLeft, top: bubbleTop, width: bubbleWidth}}>{life.line}</div>}
    {open && <section ref={panel} id={panelId} role="dialog" aria-modal="false" aria-label="问水先生互动" data-testid="pet-panel" data-pet-view={view} className={`${styles.panel} ${view === 'companion' ? styles.companionPanel : styles.studyPanel}`} style={{left: panelLeft, top: panelTop, width: panelWidth, maxHeight: maxPanelHeight, height: view === 'study' ? Math.min(590, maxPanelHeight) : undefined}}>
      <header className={styles.heading}>
        {view === 'study' ? <button type="button" aria-label="回到伙伴互动" onClick={() => setView('companion')}><ArrowLeft size={17}/></button> : <span className={styles.presenceDot}/>}
        <div><h2>问水先生</h2><small>{view === 'study' ? '遇到难题，一起想想' : statusLabel}</small></div>
        <button ref={closeButton} type="button" aria-label="关闭宠物面板" onClick={close}><X size={16}/></button>
      </header>
      {view === 'companion' ? <>
        <p className={styles.companionLine} role="status" data-testid="pet-reaction-text">{life.line}</p>
        <div className={styles.careActions}>
          <button type="button" aria-label="摸摸头" onClick={() => interact('praise')}><Hand size={19}/><span>摸摸头</span></button>
          <button type="button" aria-label="喝杯茶" onClick={() => interact('tea')}><Coffee size={19}/><span>喝杯茶</span></button>
          <button type="button" aria-label={life.sleeping ? '叫醒先生' : '休息一会'} onClick={() => { stopWalk(); if (!life.sleeping) savePet(applyPetAction(petRef.current, 'rest').state); life.toggleSleep(); }}>{life.sleeping ? <Sun size={19}/> : <Moon size={19}/>}<span>{life.sleeping ? '叫醒他' : '歇一会'}</span></button>
          <button type="button" aria-label="走一走" onClick={stroll}><Footprints size={19}/><span>走一走</span></button>
        </div>
        <div className={styles.bond}><span><Heart size={13}/>{petBondLabel(pet.affection)} · {pet.affection}</span><strong>Lv.{pet.level}</strong></div>
        <progress max={PET_LEVEL_XP} value={pet.xp} aria-label="伙伴成长经验"/>
        <small className={styles.caption}>{pet.xp} / {PET_LEVEL_XP} 经验 · 已互动 {pet.interactions} 次</small>
        <button type="button" className={styles.studyEntry} aria-label="一起学习" onClick={() => { life.wake(); setView('study'); }}><BookOpen size={17}/><span>一起学习<small>{snapshot.nodeName ? `正在看：${snapshot.nodeName}` : '提示、讲解和小练习'}</small></span><ArrowUpRight size={16}/></button>
        <div className={styles.petSettings}><button type="button" aria-label="安静陪伴" aria-pressed={life.quiet} onClick={life.toggleQuiet}><VolumeX size={13}/>{life.quiet ? '安静陪伴中' : '安静陪伴'}</button><button type="button" onClick={() => { stopWalk(); const next = defaultPetPosition(readViewport()); moveTo(next); savePosition(next); }}><RotateCcw size={13}/>位置复原</button></div>
        {warning && <small className={styles.warning} role="alert">{warning}</small>}
      </> : <>
        {learning.content}
        <div className={styles.studyFooter}><Sparkles size={12}/><span>Lv.{pet.level} · {pet.xp} / {PET_LEVEL_XP} 经验</span><small>答对新题 +10</small></div>
        {warning && <small className={styles.warning} role="alert">{warning}</small>}
      </>}
    </section>}
  </>, document.body);
}
