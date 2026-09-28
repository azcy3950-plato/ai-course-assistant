"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Compass, Download, Lightbulb, Map, RotateCcw } from 'lucide-react';
import { useApp, getAuthToken } from '@/contexts/AppContext';
import KnowledgeGraphPanel from '@/components/KnowledgeGraphPanel';
import WenshuiAvatar from './WenshuiAvatar';
import { accountStorageKey, answerStep, blankStepProgress, emptyMentorSession, findLesson, gradeStep, MENTOR_LESSONS, progressKey, resolveStepNodes, restoreMentorSession, restartStep, type MentorLesson, type MentorMode, type StepProgress } from '@/lib/mentor/course';
import { EXPERIMENT_STORAGE_PREFIX, restoreExperimentNotebook, type MentorExperimentRecord } from '@/lib/mentor/experiment';
import type { KnowledgeGraph, KnowledgeNode } from '@/types';
import styles from './mentor-workspace.module.css';

const PREFIX = 'wenshui-mentor-v1';
const emptyGraph: KnowledgeGraph = {nodes: [], edges: []};
const names: Record<string, string> = {sponge:'海绵城市', drainage:'城市排水', water:'城市给水', general:'基础设施总论', wastewater:'污水处理', power:'城市供电', resilience:'城市韧性', overview:'课程总览'};
const statusOf = (p?: StepProgress) => p?.correct ? p.assisted ? '辅助答对' : '独立答对' : p?.attempts ? '待复习' : p?.revealed ? '已看讲解' : '未作答';

export default function MentorWorkspace({onOpenChat}: {onOpenChat: () => void}) {
  const {state} = useApp();
  const [session, setSession] = useState(emptyMentorSession);
  const storageKey = state.authLoading ? null : accountStorageKey(PREFIX);
  const [loadedKey, setLoadedKey] = useState<string | null | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [graph, setGraph] = useState<KnowledgeGraph>(emptyGraph);
  const [graphError, setGraphError] = useState('');
  const [graphLoading, setGraphLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<KnowledgeNode | null>(null);
  const [exploreNetwork, setExploreNetwork] = useState('sponge');
  const [exploreAction, setExploreAction] = useState<'question' | 'explain' | 'related'>('question');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileView, setMobileView] = useState<'mentor' | 'graph'>('mentor');
  const [showRecords, setShowRecords] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [depth, setDepth] = useState<1 | 2>(1);
  const [category, setCategory] = useState('all');
  const [relationType, setRelationType] = useState('all');
  const [graphReset, setGraphReset] = useState(0);
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [experiments, setExperiments] = useState<MentorExperimentRecord[]>([]);

  useEffect(() => {
    if (state.authLoading) return;
    const key = storageKey;
    let restored = emptyMentorSession();
    let incoming = false;
    setStorageError('');
    try {
      if (key) restored = restoreMentorSession(JSON.parse(localStorage.getItem(key) || 'null'));
      const url = new URL(window.location.href);
      const requested = findLesson(url.searchParams.get('mentor'));
      if (requested) {
        if (restored.lessonId !== requested.id) restored.stepIndex = 0;
        restored.lessonId = requested.id; restored.mode = 'guided';
        incoming = true;
        url.searchParams.delete('mentor');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
      const experimentKey = accountStorageKey(EXPERIMENT_STORAGE_PREFIX);
      setExperiments(experimentKey ? restoreExperimentNotebook(JSON.parse(localStorage.getItem(experimentKey) || 'null')).records : []);
    } catch {setStorageError('本机记录无法读取，本次可以继续学习；新操作会建立新的本机记录。');}
    setSession(restored); setLoadedKey(key); setDirty(incoming); setReady(true);
  }, [state.authLoading, storageKey]);

  useEffect(() => {
    if (!ready || !dirty || !storageKey || loadedKey !== storageKey) return;
    try {
      if (accountStorageKey(PREFIX) !== storageKey) return;
      localStorage.setItem(storageKey, JSON.stringify(session)); setStorageError('');
    } catch {setStorageError('学习记录保存失败，刷新可能丢失本次进度。请先导出学习记录。');}
  }, [session, storageKey, loadedKey, ready, dirty]);

  useEffect(() => {
    if (state.authLoading) return;
    const abort = new AbortController();
    setGraphLoading(true); setGraphError('');
    fetch('/api/knowledge-graph?network=all', {headers:{Authorization:`Bearer ${getAuthToken()}`}, signal:abort.signal})
      .then(async response => {if (!response.ok) throw new Error(response.status === 401 ? '请先登录，再载入你的课程图谱。' : '课程图谱暂时无法加载，请重试。'); return response.json();})
      .then(data => {if (!data.graph?.nodes || !data.graph?.edges) throw new Error('课程图谱数据不完整，请重试。'); setGraph(data.graph);})
      .catch(error => {if (!abort.signal.aborted) setGraphError(error.message);})
      .finally(() => {if (!abort.signal.aborted) setGraphLoading(false);});
    return () => abort.abort();
  }, [state.authLoading, storageKey, retry]);

  const lesson = findLesson(session.lessonId);
  const step = lesson?.steps[session.stepIndex];
  const key = lesson && step ? progressKey(lesson, step) : '';
  const progress = session.progress[key] || blankStepProgress();
  const network = session.mode === 'explore' ? exploreNetwork : lesson?.network || 'sponge';
  const networkGraph = useMemo(() => {
    const nodes = graph.nodes.filter(node => node.id.startsWith(network + ':'));
    const ids = new Set(nodes.map(node => node.id));
    return {...graph, nodes, edges:graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target))};
  }, [graph, network]);
  const stepNodes = useMemo(() => step && lesson ? resolveStepNodes(step, graph, lesson.network) : [], [step, lesson, graph]);
  const focusIds = selected ? [selected.id] : session.mode === 'explore' ? [] : stepNodes.map(node => node.id);
  const neighbors = selected ? networkGraph.edges.filter(edge => edge.source === selected.id || edge.target === selected.id).map(edge => ({edge, node:networkGraph.nodes.find(node => node.id === (edge.source === selected.id ? edge.target : edge.source))})).filter(item => item.node).slice(0, 7) : [];
  const allProgress = Object.values(session.progress);
  const independent = allProgress.filter(p => p.correct && !p.assisted).length;
  const assisted = allProgress.filter(p => p.correct && p.assisted).length;
  const weak = MENTOR_LESSONS.flatMap(l => l.steps.filter(s => {const p = session.progress[progressKey(l,s)]; return p && (p.assisted || (p.attempts > 0 && !p.correct));}).map(s => ({lesson:l, step:s})));
  const complete = lesson?.steps.every(s => session.progress[progressKey(lesson,s)]?.correct);
  const latestExperiment = experiments.find(record => record.lessonId === lesson?.id);

  const updateProgress = useCallback((change: (p: StepProgress) => StepProgress) => {
    if (!key) return;
    setDirty(true);
    setSession(old => ({...old, progress:{...old.progress, [key]:change(old.progress[key] || blankStepProgress())}}));
  }, [key]);
  const navigate = (l: MentorLesson, index = 0) => {
    setDirty(true);
    setSession(old => ({...old, lessonId:l.id, stepIndex:index, mode:old.mode === 'explore' ? 'guided' : old.mode}));
    setSelected(null); setShowExample(false); setShowRecords(false); setCollapsed(false); setMobileView('mentor'); setCategory('all'); setRelationType('all');
  };
  const setMode = (mode: MentorMode) => {setDirty(true);setSession(old => ({...old, mode})); setSelected(null); setShowRecords(false); setShowExample(false);};
  const exportRecords = () => {
    const content = JSON.stringify({exportedAt:new Date().toISOString(), scope:'当前账号在本浏览器的学习记录', session, experiments}, null, 2);
    const url = URL.createObjectURL(new Blob([content], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = '问水先生-学习记录.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const selectNode = (node: KnowledgeNode) => {setSelected(node); setExploreAction('question'); if (session.mode === 'explore') setMobileView('mentor');};
  const focusNode = (node: KnowledgeNode | null) => {setCategory('all');setRelationType('all');setGraphReset(v=>v+1);setGraphCollapsed(false);setSelected(node);setMobileView('graph');};
  const mood = progress.correct ? 'celebrate' : progress.choice ? 'thinking' : lesson ? 'question' : 'idle';

  return <div className={styles.workspace} data-testid="mentor-workspace">
    <header className={styles.header}>
      <div className={styles.brand}><WenshuiAvatar size={64}/><div><span className={styles.eyebrow}>城市与水 · 一起追问</span><h1>问水先生的学习庭院</h1></div></div>
      <div className={styles.headerActions}><button onClick={() => {setShowRecords(!showRecords); setCollapsed(false); setMobileView('mentor');}}><BookOpen size={16}/>学习记录</button><button onClick={onOpenChat}>自由对话 <ArrowRight size={15}/></button></div>
    </header>
    <div className={styles.mobileTabs}><button aria-pressed={mobileView === 'mentor'} onClick={() => {setMobileView('mentor');setCollapsed(false);}}>问水导师</button><button aria-pressed={mobileView === 'graph'} onClick={() => {setMobileView('graph');setGraphCollapsed(false);}}>知识图谱</button></div>
    <div className={`${styles.body} ${collapsed ? styles.collapsed : ''} ${graphCollapsed ? styles.graphCollapsed : ''}`}>
      <section className={`${styles.graphArea} ${mobileView !== 'graph' && !collapsed ? styles.mobileHidden : ''}`} aria-label="课程知识图谱">
        <div className={styles.graphHeader}><div><span className={styles.smallLabel}>看见知识之间的联系</span><h2>{names[network] || network}</h2></div><span className={styles.graphCount}>{networkGraph.nodes.length} 个课程节点</span></div>
        {graphLoading ? <div className={styles.graphMessage} role="status">正在载入课程知识图谱…</div> : graphError ? <div className={styles.graphMessage} role="alert"><p>{graphError}</p><button onClick={() => setRetry(v => v+1)}>重新加载</button><Link href="/login">前往登录</Link></div> : <div className={styles.graphCanvas} hidden={graphCollapsed}>
          <KnowledgeGraphPanel hideModeControls key={`${network}:${session.lessonId}:${session.stepIndex}:${graphReset}`} graph={networkGraph} focusIds={focusIds} selectedNodeId={selected?.id} depth={depth} mode="current" nodeCategory={category} relationType={relationType} onModeChange={() => {}} onDepthChange={setDepth} onNodeCategory={setCategory} onRelationType={setRelationType} onNodeClick={selectNode} onExpand={selectNode} onAsk={node => {selectNode(node);setMode('explore');setSelected(node);setExploreNetwork(network);setMobileView('mentor');}} onFullscreen={() => {const element = document.querySelector('[data-testid="mentor-workspace"]'); if (document.fullscreenElement) void document.exitFullscreen?.(); else void element?.requestFullscreen?.().catch(() => {});}} onCollapsePanel={() => {setGraphCollapsed(true);setMobileView('mentor');}}/>
        </div>}
        {graphCollapsed && <button className={styles.secondary} onClick={() => setGraphCollapsed(false)}>展开课程图谱</button>}<div className={styles.graphFoot}><Map size={16}/><span>{focusIds.length ? `当前聚焦：${focusIds.map(id => graph.nodes.find(n => n.id === id)?.name).filter(Boolean).join('、')}` : '点击一个节点，从你感兴趣的地方出发。'}</span>{selected && <button onClick={() => focusNode(null)}>回到学习焦点</button>}</div>
        {collapsed && <button className={styles.reopen} data-testid="mentor-expand" onClick={() => {setCollapsed(false);setMobileView('mentor');}}><WenshuiAvatar size={48}/><span>问水先生<br/><small>接着一起想</small></span><ArrowLeft size={16}/></button>}
      </section>
      {!collapsed && <aside className={`${styles.panel} ${mobileView !== 'mentor' ? styles.mobileHidden : ''}`} aria-label="问水导师">
        <div className={styles.panelTop}><label>陪学方式 <select data-testid="mentor-mode" aria-label="陪学方式" value={session.mode} onChange={e => setMode(e.target.value as MentorMode)}><option value="guided">引导学习</option><option value="quiz">考考我</option><option value="explore">安静探索</option></select></label><button data-testid="mentor-collapse" aria-label="收起问水导师" title="收起问水导师" onClick={() => {setCollapsed(true);setGraphCollapsed(false);}}><ChevronDown size={18}/></button></div>
        <div className={styles.panelScroll}>
          {!ready || loadedKey !== storageKey ? <p role="status">正在恢复学习位置…</p> : showRecords ? <>
            <div className={styles.sectionTitle}><span className={styles.eyebrow}>把思考留下来</span><h2>我的学习手记</h2><p>记录选择、线索和解释；一次答对是证据的一部分。</p></div>
            <div className={styles.stats}><div><strong>{independent}</strong><span>独立答对</span></div><div><strong>{assisted}</strong><span>辅助答对</span></div><div><strong>{weak.length}</strong><span>建议复习</span></div></div>
            {MENTOR_LESSONS.map(l => <section className={styles.recordGroup} key={l.id}><h3>{l.title}</h3>{l.steps.map((s,i) => {const p=session.progress[progressKey(l,s)];return <button key={s.id} onClick={() => navigate(l,i)}><span>{s.title}<small>{p?.note ? '已留下思考 · ' : ''}{p?.attempts || 0} 次作答</small></span><em>{statusOf(p)}</em></button>;})}</section>)}
            {weak.length > 0 && <button className={styles.primary} onClick={() => navigate(weak[0].lesson, weak[0].lesson.steps.indexOf(weak[0].step))}><RotateCcw size={16}/>从待复习的地方开始</button>}
            <button className={styles.secondary} onClick={exportRecords}><Download size={16}/>导出学习记录</button><button className={styles.textButton} onClick={() => setShowRecords(false)}>返回学习</button>
          </> : session.mode === 'explore' ? <>
            <div className={styles.welcome}><WenshuiAvatar mood="idle" size={116}/><h2>你来选方向，我在这里。</h2><p>自由转动图谱，点选一个节点。需要时，再向我要一条线索。</p></div>
            <label className={styles.field}>探索专题<select value={exploreNetwork} onChange={e => {setExploreNetwork(e.target.value);setSelected(null);}}>{Object.entries(names).map(([id,name]) => <option value={id} key={id}>{name}</option>)}</select></label>
            {selected ? <section className={styles.questionCard}><span className={styles.eyebrow}>当前节点</span><h3>{selected.name}</h3><div className={styles.tools}><button onClick={() => setExploreAction('question')}>给我线索</button><button onClick={() => setExploreAction('explain')}>解释概念</button><button onClick={() => setExploreAction('related')}>相关节点</button></div>{exploreAction === 'question' ? <p>先用自己的话解释“{selected.name}”，再想一想：它解决了什么问题，又受哪些条件限制？</p> : exploreAction === 'explain' ? <p>{selected.description || '这个节点暂未配置说明，可以先查看相关节点。'}</p> : <div className={styles.related}>{neighbors.length ? neighbors.map(({node,edge}) => <button key={edge.id} onClick={() => setSelected(node!)}>{edge.label || edge.relation} · {node!.name}</button>) : <p>课程图谱中暂无该节点的关联关系。</p>}</div>}</section> : <button className={styles.secondary} onClick={() => setMobileView('graph')}><Compass size={16}/>去图谱选择一个节点</button>}
            <button className={styles.textButton} onClick={() => setMode('guided')}>想要一条路线？返回引导学习 →</button>
          </> : !lesson || !step ? <>
            <div className={styles.welcome}><WenshuiAvatar mood="question" size={138}/><span className={styles.eyebrow}>不急着回答，先问一个好问题</span><h2>今天，想弄懂什么？</h2><p>选一个目标。我们用三个问题，走到原理里面。</p></div>
            <div className={styles.goals}>{MENTOR_LESSONS.map((l,i) => {const done=l.steps.filter(s => session.progress[progressKey(l,s)]?.correct).length;return <button key={l.id} data-testid={`goal-${l.id}`} onClick={() => navigate(l)}><span className={styles.goalNumber}>0{i+1}</span><span><strong>{l.title}</strong><small>{l.subtitle}</small><em>{l.minutes} 分钟 · 3 个问题{done ? ` · 已答对 ${done}/3` : ''}{l.experiment ? ' · 沙盘验证' : ''}</em></span><ArrowRight size={18}/></button>;})}</div>
          </> : <>
            <button className={styles.textButton} onClick={() => {setDirty(true);setSession(old => ({...old,lessonId:null,stepIndex:0}));setSelected(null);}}><ArrowLeft size={14}/>更换学习目标</button>
            <div className={styles.lessonTitle}><span className={styles.eyebrow}>{names[lesson.network]} · 约 {lesson.minutes} 分钟</span><h2>{lesson.title}</h2></div>
            <nav className={styles.steps} aria-label="学习步骤">{lesson.steps.map((s,i) => <button key={s.id} data-testid={`step-${s.id}`} aria-current={i === session.stepIndex ? 'step' : undefined} onClick={() => navigate(lesson,i)}><span>{session.progress[progressKey(lesson,s)]?.correct ? <Check size={14}/> : i+1}</span><small>{s.title}</small></button>)}</nav>
            <div className={styles.teacherLine}><WenshuiAvatar mood={mood} size={85}/><p>{progress.correct ? progress.assisted ? '顺着线索想通了。下次试着自己说出原因。' : '这个判断有道理。再说说你为什么这样想。' : progress.choice ? '先别急着换答案。看看是哪一步推理需要调整。' : session.mode === 'quiz' ? '这次由你先判断。提交后，我们再一起复盘。' : '先凭直觉想一想，需要时可以向我要线索。'}</p></div>
            <section className={styles.questionCard}><span className={styles.smallLabel}>问题 {session.stepIndex+1} / {lesson.steps.length}</span><h3>{step.question}</h3><div className={styles.answers}>{step.options.map(option => <button key={option.id} data-testid={`answer-${option.id}`} disabled={progress.correct} aria-pressed={progress.choice === option.id} onClick={() => updateProgress(p => answerStep(step,p,option.id))}><span>{option.id.toUpperCase()}</span>{option.text}</button>)}</div>
              {progress.choice && <div className={`${styles.feedback} ${progress.correct ? styles.correct : ''}`} data-testid="mentor-result" data-correct={progress.correct} data-assisted={progress.assisted} role="status"><strong>{statusOf(progress)}</strong><p>{gradeStep(step,progress.choice)?.feedback}</p>{!progress.correct && stepNodes.length > 0 && <button onClick={() => focusNode(null)}>回看相关概念：{stepNodes.map(n=>n.name).join('、')} →</button>}</div>}
            </section>
            <div className={styles.tools}><button data-testid="mentor-hint" disabled={progress.hintLevel >= 3 || progress.correct} onClick={() => updateProgress(p => ({...p,hintLevel:Math.min(3,p.hintLevel+1),assisted:true}))}><Lightbulb size={16}/>线索 {progress.hintLevel}/3</button><button data-testid="mentor-explain" disabled={session.mode === 'quiz' && !progress.choice} onClick={() => updateProgress(p => ({...p,revealed:true,reviewedAfterAnswer:p.reviewedAfterAnswer || (p.correct && !p.assisted),assisted:p.assisted || !p.correct}))}>直接解释</button><button disabled={session.mode === 'quiz' && !progress.choice} onClick={() => {setShowExample(!showExample); if (!progress.correct) updateProgress(p=>({...p,assisted:true}));}}>举个例子</button></div>
            {session.mode === 'quiz' && !progress.choice && <p className={styles.muted}>先作答，再看讲解；可以使用三层线索。</p>}
            {progress.hintLevel > 0 && <div className={styles.hints}>{step.hints.slice(0,progress.hintLevel).map((hint,i) => <p key={hint}><span>线索 {i+1}</span>{hint}</p>)}</div>}
            {progress.revealed && <div className={styles.explanation}><h4>把推理补完整</h4><p>{step.explanation}</p></div>}
            {showExample && <div className={styles.explanation}><h4>放进一个真实情境</h4><p>{step.example}</p></div>}
            {progress.correct && <button className={styles.textButton} data-testid="mentor-retry" onClick={() => {updateProgress(p=>restartStep(step,p));setShowExample(false);}}><RotateCcw size={14}/>重新挑战本题（保留手记与历史）</button>}
            {progress.history.length > 0 && <details className={styles.explanation}><summary>本题最近 {progress.history.length} 次挑战记录</summary>{progress.history.map((attempt,i) => <p key={i}>第 {i+1} 次 · {attempt.correct ? attempt.assisted ? '辅助答对' : '独立答对' : attempt.attempts ? '未答对' : '看过线索或讲解'} · {attempt.attempts} 次作答 · {attempt.hintLevel} 层线索</p>)}</details>}
            <div className={styles.conceptChips}><span>课程节点</span>{stepNodes.map(node => <button key={node.id} onClick={() => focusNode(node)}>{node.name}</button>)}{!graphLoading && !graphError && stepNodes.length === 0 && <small>暂无可匹配节点</small>}</div>
            <label className={styles.field}>{step.reflection}<textarea data-testid="mentor-note" value={progress.note} maxLength={2000} rows={3} onChange={e => {const note=e.target.value;updateProgress(p=>({...p,note}));}} placeholder="写下你的解释、预测或仍然不确定的地方…"/></label>
            <div className={styles.nextRow}>{session.stepIndex > 0 && <button className={styles.secondary} onClick={() => navigate(lesson,session.stepIndex-1)}>上一步</button>}{session.stepIndex < lesson.steps.length-1 ? <button className={styles.primary} data-testid="mentor-next" onClick={() => navigate(lesson,session.stepIndex+1)}>继续下一个问题 <ArrowRight size={16}/></button> : <button className={styles.primary} data-testid="mentor-next" onClick={() => setShowRecords(true)}>回看我的学习 <BookOpen size={16}/></button>}</div>
            {session.stepIndex === lesson.steps.length-1 && <section className={styles.experiment}><span className={styles.eyebrow}>{complete ? '三个问题，已经走过' : '把想法放进实践'}</span><h3>{lesson.experiment ? '让一场雨来检验你的预测。' : '把原理说给别人听。'}</h3><p>{lesson.experiment ? '保持降雨和其他条件相同，改变设施面积；比较径流总量和峰值流量。' : '回看你写下的解释。哪些条件改变后，结论也需要重新判断？'}</p>{lesson.experiment && <Link className={styles.primary} href={`/sandbox?mentor=${lesson.experiment}`}>去沙盘验证 <ArrowRight size={16}/></Link>}</section>}
            {latestExperiment && <section className={styles.explanation}><h4>从沙盘带回的证据</h4><p>径流总量：{latestExperiment.baseline.runoffVolume.toFixed(1)} → {latestExperiment.proposed.runoffVolume.toFixed(1)} m³<br/>峰值流量：{latestExperiment.baseline.peakFlow.toFixed(3)} → {latestExperiment.proposed.peakFlow.toFixed(3)} m³/s</p><p>{latestExperiment.stale ? '这是一份历史方案的计算结果。' : '这是你最近一次实验的计算结果。'}只在相同实验条件下比较。</p><p>我的反思：{latestExperiment.reflection || '还没有留下反思，可以返回沙盘补充。'}</p><Link href={`/sandbox?mentor=${lesson.experiment}`}>返回实验手记 →</Link></section>}
          </>}
        </div>
        <footer className={styles.panelFooter}><span role="status">{storageError || (storageKey ? dirty ? '已自动保存于本浏览器 · 按账号区分' : '学习记录仅保存在本浏览器 · 按账号区分' : '本次学习暂存于页面 · 登录后可保存')}</span><button aria-label="导出学习记录" onClick={exportRecords}><Download size={16}/></button></footer>
      </aside>}
    </div>
  </div>;
}
