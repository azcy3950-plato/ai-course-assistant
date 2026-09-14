"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeGraph, KnowledgeNode } from "@/types";
import { getAuthToken } from "@/contexts/AppContext";
import ConceptLab from "./ConceptLab";
import PracticePanel from "./PracticePanel";
import Notebook, { Replay } from "./Notebook";
import { conceptContent, type Practice } from "./learning-content";
import { emptySession, restoreSession, uid, type Thought, type WorkspaceSession } from "./model";
import "@/app/guided/guided.css";
import "./legacy-interactions.css";

export type LearningTool = "compare" | "lab" | "practice" | "notes" | "replay";
type Chat = { id: string; role: "user" | "assistant"; content: string; nodeIds?: string[]; pending?: boolean; error?: boolean; kind?: string };
type Props = { open: LearningTool | null; onOpen: (tool: LearningTool | null) => void; selected: KnowledgeNode | null; network: string; messages: Chat[]; onFocus: (node: KnowledgeNode) => void; onQuestion: (question: string) => void; collectRequest: number; compareRequest: number };

export default function LegacyLearningTools(p: Props) {
  const [graph, setGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [saved, setSaved] = useState<WorkspaceSession>(emptySession);
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const [retry, setRetry] = useState(0), [storageError, setStorageError] = useState(false);
  const [compared, setCompared] = useState<string[]>([]), [aspect, setAspect] = useState("definition");
  const [replayIndex, setReplayIndex] = useState(-1), [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState("");
  const storageKey = useRef("");
  const focusRef = useRef(p.onFocus); focusRef.current = p.onFocus;
  const dialog = useRef<HTMLDivElement>(null);
  const nodes = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph]);
  useEffect(() => {
    const controller = new AbortController(); setError("");
    (async () => {
      try {
        const res = await fetch("/api/knowledge-graph?network=all", { headers: { Authorization: `Bearer ${getAuthToken()}` }, signal: controller.signal });
        const data = await res.json(); if (!res.ok || !data.graph?.nodes?.length) throw new Error(data.error || "互动资料加载失败");
        if (controller.signal.aborted) return;
        setGraph(data.graph);
        try {
          const user = JSON.parse(localStorage.getItem("aicourse-user") || "{}"); const account = user.email || user.id;
          storageKey.current = account ? `guided-tools-v1:${encodeURIComponent(account)}` : "";
          const raw = storageKey.current && localStorage.getItem(storageKey.current);
          if (raw) setSaved(restoreSession(JSON.parse(raw), new Set<string>(data.graph.nodes.map((n: KnowledgeNode) => n.id))));
        } catch { setStorageError(true); }
        setReady(true);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "互动资料加载失败"); }
    })(); return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (!ready || !storageKey.current) return;
    const timer = window.setTimeout(() => { try { localStorage.setItem(storageKey.current, JSON.stringify(saved)); setStorageError(false); } catch { setStorageError(true); } }, 250);
    return () => window.clearTimeout(timer);
  }, [saved, ready]);
  useEffect(() => {
    if (!ready || !p.selected) return;
    const node = p.selected;
    setSaved(old => old.trail.at(-1)?.nodeId === node.id ? old : ({ ...old, visited: [...new Set([...old.visited, node.id])], trail: [...old.trail, { id: uid(), nodeId: node.id, title: `探索${node.name}`, detail: conceptContent(node).definition, kind: "explore" as const }].slice(-80) }));
  }, [p.selected?.id, ready]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 2500); return () => window.clearTimeout(timer); }, [notice]);
  const collect = (id: string) => {
    setSaved(old => old.saved.some(c => c.nodeId === id) || old.saved.length >= 24 ? old : ({ ...old, saved: [...old.saved, { nodeId: id, note: "", x: (old.saved.length % 3) * 240 + 20, y: Math.floor(old.saved.length / 3) * 185 + 20 }] }));
    setNotice(`“${nodes.get(id)?.name || "概念"}”已在整理区中`);
  };
  useEffect(() => { if (p.collectRequest && p.selected) collect(p.selected.id); }, [p.collectRequest]);
  useEffect(() => { if (p.compareRequest && p.selected) setCompared(old => old.includes(p.selected!.id) ? old : [...old, p.selected!.id].slice(-2)); }, [p.compareRequest]);
  useEffect(() => { if (!p.open) setPlaying(false); }, [p.open]);
  useEffect(() => {
    if (!p.open) return;
    const prior = document.activeElement as HTMLElement | null;
    const items = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, textarea, input, [tabindex="0"]') || []).filter(e => e.getClientRects().length);
    const t = window.setTimeout(() => items()[0]?.focus(), 0);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") p.onOpen(null);
      if (e.key === "Tab") { const list = items(); if (e.shiftKey && document.activeElement === list[0]) { e.preventDefault(); list.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === list.at(-1)) { e.preventDefault(); list[0]?.focus(); } }
    };
    window.addEventListener("keydown", key);
    return () => { window.clearTimeout(t); window.removeEventListener("keydown", key); if (prior?.isConnected) prior.focus(); };
  }, [p.open]);
  const focusNames = (names: string[], network = p.network) => {
    const node = names.map(name => graph.nodes.find(n => n.name === name && n.id.startsWith(network + ":")) || graph.nodes.find(n => n.name === name)).find(Boolean);
    if (node) focusRef.current(node);
  };
  const activity = (title: string, detail: string, names: string[], network = p.network) => {
    const node = names.map(name => graph.nodes.find(n => n.name === name && n.id.startsWith(network + ":")) || graph.nodes.find(n => n.name === name)).find(Boolean) || p.selected;
    if (!node) return;
    setSaved(old => ({ ...old, trail: [...old.trail, { id: uid(), nodeId: node.id, title, detail, kind: "summary" as const }].slice(-80) })); setNotice("已记入学习路径");
  };
  const thoughts: Thought[] = useMemo(() => p.messages.filter(m => m.role === "user" && !m.error).map(m => {
    const i = p.messages.findIndex(a => a.id === m.id), feedback = p.messages[i + 1];
    return { id: m.id, text: m.content, feedback: feedback?.role === "assistant" && !feedback.pending ? feedback.content : "", nodeIds: feedback?.nodeIds || m.nodeIds || [], status: feedback?.kind === "final" ? "summarized" : "thinking" };
  }), [p.messages]);
  const trail = useMemo(() => [...saved.trail, ...thoughts.filter(t => t.nodeIds.some(id => nodes.has(id))).map(t => ({ id: t.id, nodeId: t.nodeIds.find(id => nodes.has(id))!, title: "我的思考", detail: t.text, kind: "answer" as const }))].slice(-100), [saved.trail, thoughts, nodes]);
  useEffect(() => {
    if (!playing || !trail.length) return;
    const index = Math.max(0, replayIndex), node = nodes.get(trail[index]?.nodeId); if (node) focusRef.current(node);
    const timer = window.setTimeout(() => { if (index >= trail.length - 1) setPlaying(false); else setReplayIndex(index + 1); }, 2200);
    return () => window.clearTimeout(timer);
  }, [playing, replayIndex, trail, nodes]);
  const exportSummary = () => {
    const text = ["# 引导学习小结", "", saved.notes, "", "## 我的概念卡", ...saved.saved.flatMap(c => [`### ${nodes.get(c.nodeId)?.name}`, c.note, ""]), "## 我的思路", ...thoughts.flatMap(t => [t.text, t.feedback, ""]), "## 学习路径", ...trail.map((t, i) => `${i + 1}. ${t.title}：${t.detail}`)].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "引导学习小结.md"; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  const result = (ex: Practice, correct: boolean, assisted: boolean) => {
    setSaved(old => ({ ...old, practiceResults: { ...old.practiceResults, [ex.id]: { correct, assisted } } }));
    activity(ex.title, correct ? `${assisted ? "提示后完成" : "独立答对"}。${ex.explanation}` : "已尝试，需要调整高亮位置。", ex.nodeNames);
  };
  return <>
    {notice && <div className="legacy-tool-toast" role="status">{notice}</div>}
    {p.open && <div className="legacy-tool-layer" onClick={() => p.onOpen(null)}><div ref={dialog} role="dialog" aria-modal="true" aria-label="学习互动工具" className={`gx-root legacy-tool-dialog ${p.open === "compare" ? "legacy-tool-wide" : ""}`} onClick={e => e.stopPropagation()}>
      <header className="legacy-tool-header"><strong>学习互动工具</strong><button aria-label="关闭互动工具" onClick={() => p.onOpen(null)}>×</button></header>
      <nav className="gx-tabs" aria-label="互动工具分类">{([["compare", "概念比较"], ["lab", "原理演示"], ["practice", "动手练习"], ["notes", "我的整理"], ["replay", "学习回放"]] as const).map(([id, label]) => <button key={id} aria-pressed={p.open === id} onClick={() => { setPlaying(false); p.onOpen(id); }}>{label}</button>)}</nav>
      {storageError && <p role="status" className="gx-muted">本地保存暂时不可用，请使用导出保存记录。</p>}
      {error ? <div role="alert"><p>{error}</p><button onClick={() => setRetry(v => v + 1)}>重新加载互动资料</button></div> : !ready ? <p>正在加载互动资料…</p> : <div className="legacy-tool-body">
        {p.open === "compare" && <section><h2>放在一起看，更容易理解</h2><div className="gx-compare-pickers">{[0, 1].map(i => <label key={i}>概念 {i + 1}<select aria-label={`比较概念${i + 1}`} value={compared[i] || ""} onChange={e => setCompared(old => { const next = [...old]; next[i] = e.target.value; return next; })}><option value="">选择一个知识点</option>{graph.nodes.map(n => <option key={n.id} value={n.id} disabled={compared[1 - i] === n.id}>{n.name} · {n.chapter}</option>)}</select></label>)}</div><div className="gx-tabs">{[["definition", "是什么"], ["example", "看例子"], ["condition", "适用条件"], ["misconception", "常见误区"]].map(([id, label]) => <button key={id} aria-pressed={aspect === id} onClick={() => setAspect(id)}>{label}</button>)}</div><div className="gx-compare-columns">{[0, 1].map(i => { const n = nodes.get(compared[i]); return n ? <article key={`${n.id}-${aspect}`} className="gx-enter"><h3>{n.name}</h3><p>{conceptContent(n)[aspect as keyof ReturnType<typeof conceptContent>]}</p><div className="gx-actions"><button onClick={() => focusRef.current(n)}>图谱定位</button><button onClick={() => collect(n.id)}>加入整理</button></div></article> : <div className="gx-compare-placeholder" key={i}>选择上方概念，或关闭面板后从图谱节点“更多互动”加入比较。</div>; })}</div></section>}
        {p.open === "lab" && <ConceptLab network={p.network} name={p.selected?.name} onFocus={focusNames} onActivity={activity} />}
        {p.open === "practice" && <PracticePanel onFocus={focusNames} onResult={result} />}
        {p.open === "notes" && <><div className="gx-actions"><button disabled={!p.selected} onClick={() => p.selected && collect(p.selected.id)}>收集当前概念</button><button onClick={exportSummary}>导出学习小结</button></div><Notebook nodes={nodes} saved={saved.saved} links={saved.links} thoughts={thoughts} notes={saved.notes} onSaved={items => setSaved(old => ({ ...old, saved: items }))} onLinks={links => setSaved(old => ({ ...old, links }))} onNotes={notes => setSaved(old => ({ ...old, notes }))} onFocus={ids => { const node = ids.map(id => nodes.get(id)).find(Boolean); if (node) focusRef.current(node); }} onRevisit={q => { p.onQuestion(q); p.onOpen(null); }} /></>}
        {p.open === "replay" && <Replay trail={trail} current={replayIndex} playing={playing} onPlay={() => { if (replayIndex < 0 || replayIndex >= trail.length - 1) setReplayIndex(0); setPlaying(true); }} onPause={() => setPlaying(false)} onStep={index => { setPlaying(false); setReplayIndex(index); const node = nodes.get(trail[index]?.nodeId); if (node) focusRef.current(node); }} onStop={() => { setPlaying(false); setReplayIndex(-1); }} onExport={exportSummary} />}
      </div>}
    </div></div>}
  </>;
}
