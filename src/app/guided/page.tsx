"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, getAuthToken } from "@/contexts/AppContext";
import KnowledgeGraphPanel from "@/components/KnowledgeGraphPanel";
import { computeNetworkMastery, weakestNodes, networkIdOf, type NetworkMastery } from "@/lib/mastery-stats";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "@/types";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; nodeIds?: string[]; concepts?: KnowledgeNode[]; pending?: boolean; error?: boolean; kind?: "answer" | "hint" | "final" | "info" };
const STORAGE_KEY = "guided-workspace-ratio";
const CHAT_STORAGE_KEY = "guided-chat-v1";
const suggested = ["海绵城市如何减少内涝？", "SWMM 模型的核心原理是什么？", "排水管网设计标准如何选择？", "LID 设施应该怎样组合使用？"];
const MAX_TURNS = 3;
const MAX_HINTS = 4;

function mergeGraph(base: KnowledgeGraph, nodes: KnowledgeNode[], edges: KnowledgeEdge[]): KnowledgeGraph {
  const nodeMap = new Map(base.nodes.map((n) => [n.id, n])); nodes.forEach((n) => nodeMap.set(n.id, nodeMap.get(n.id) || n));
  const edgeMap = new Map(base.edges.map((e) => [e.id, e])); edges.forEach((e) => { if (nodeMap.has(e.source) && nodeMap.has(e.target)) edgeMap.set(e.id, e); });
  return { ...base, nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
}

export default function GuidedPage() {
  const { state } = useApp();
  const [fullGraph, setFullGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [cumulative, setCumulative] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [currentGraph, setCurrentGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [focusIds, setFocusIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<KnowledgeNode | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [socraticActive, setSocraticActive] = useState(false);
  const [socraticQuestion, setSocraticQuestion] = useState("");
  const [turn, setTurn] = useState(0);
  const [hintLevel, setHintLevel] = useState(0);
  const [mode, setMode] = useState<"current" | "cumulative">("current");
  const [depth, setDepth] = useState<1 | 2>(1);
  const [ratio, setRatio] = useState(42);
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [mobileTab, setMobileTab] = useState<"graph" | "chat">("chat");
  const [nodeCategory, setNodeCategory] = useState("all");
  const [relationType, setRelationType] = useState("all");
  // 8 网络切换(总览/总论/给水/排水/污水/海绵/供电/韧性)
  const [networks, setNetworks] = useState<Array<{ id: string; chip: string; title: string; summary: string; sections?: Array<{ label: string; full: string; target?: string | null }> }>>([]);
  const [activeNetwork, setActiveNetwork] = useState("overview");
  // 总览「全部展开」:加载 8 网络全部 257 节点,按网络分色
  const [expandAll, setExpandAll] = useState(false);
  const NETWORK_COLORS: Record<string, string> = {
    overview: "#64748b", general: "#165dff", water: "#0891b2", drainage: "#059669",
    wastewater: "#7c3aed", sponge: "#16a34a", power: "#ea580c", resilience: "#db2777",
  };
  const toggleExpandAll = () => {
    const target = expandAll ? "overview" : "all";
    setExpandAll(!expandAll);
    fetch(`/api/knowledge-graph?network=${target}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } }).then((r) => r.json()).then((d) => {
      if (!d.graph) return;
      const colored = target === "all" ? d.graph.nodes.map((n: KnowledgeNode) => ({ ...n, color: NETWORK_COLORS[String(n.id).split(":")[0]] || NETWORK_COLORS.overview })) : d.graph.nodes;
      setFullGraph({ ...d.graph, nodes: colored }); setCurrentGraph({ ...d.graph, nodes: colored });
      setCumulative({ nodes: [], edges: [] });
      mergeAllNodes(d.graph.nodes);
      setFocusIds(colored.slice(0, 1).map((n: KnowledgeNode) => n.id));
    }).catch(() => undefined);
  };
  const workspace = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const reqSeqRef = useRef(0);
  const dragging = useRef(false);
  const [resizing, setResizing] = useState(false);

  useEffect(() => { let saved = 0; try { saved = Number(localStorage.getItem(STORAGE_KEY)); } catch { /* 隐私模式忽略 */ } if (saved >= 30 && saved <= 62) setRatio(saved); fetch("/api/knowledge-graph?network=overview", { headers: { Authorization: `Bearer ${getAuthToken()}` } }).then((r) => r.json()).then((d) => { if (!d.graph) return; setFullGraph(d.graph); setCurrentGraph(d.graph); setNetworks(d.networks || []); // 网络数据就绪后再恢复对话焦点(校验 id 归属当前网络,避免跨网络残留焦点)
      try {
        const raw = localStorage.getItem(CHAT_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.messages)) {
            const msgs = (parsed.messages as ChatMessage[]).filter((m) => m && typeof m.content === "string" && !m.pending);
            if (msgs.length) {
              setMessages(msgs);
              const lastNodes = [...msgs].reverse().find((m) => m.nodeIds?.length)?.nodeIds;
              if (lastNodes?.length) {
                const validNode = lastNodes.find((id: string) => d.graph.nodes.some((n: KnowledgeNode) => n.id === id));
                setFocusIds(validNode ? [validNode] : d.graph.nodes.slice(0, 1).map((n: KnowledgeNode) => n.id));
                return;
              }
            }
          }
          if (parsed.socratic && typeof parsed.socratic.active === "boolean") { setSocraticActive(parsed.socratic.active); if (typeof parsed.socratic.question === "string") setSocraticQuestion(parsed.socratic.question); if (typeof parsed.socratic.turn === "number") setTurn(parsed.socratic.turn); if (typeof parsed.socratic.hintLevel === "number") setHintLevel(parsed.socratic.hintLevel); }
        }
      } catch { /* 旧数据/隐私模式忽略 */ }
      setFocusIds(d.graph.nodes.slice(0, 1).map((n: KnowledgeNode) => n.id));
    }).catch(() => undefined); }, []);
  // 切换知识网络:加载对应网络图谱,保留对话(不打断学习上下文),重置选中与聚焦
  const [masteryStats, setMasteryStats] = useState<NetworkMastery[]>([]);
  const [weakList, setWeakList] = useState<KnowledgeNode[]>([]);

  // 掌握度刷新:拉全部节点 progress,更新仪表盘/薄弱列表,并同步当前图节点 progress(色阶实时)
  const refreshMastery = useCallback(() => {
    if (networks.length === 0) return;
    fetch("/api/knowledge-graph?network=all", { headers: { Authorization: `Bearer ${getAuthToken()}` } })
      .then((r) => r.json()).then((d) => {
        if (!d.graph?.nodes?.length) return;
        setMasteryStats(computeNetworkMastery(d.graph.nodes, networks.map((n) => n.id)));
        setWeakList(weakestNodes(d.graph.nodes, 3));
        setCurrentGraph((g) => ({ ...g, nodes: g.nodes.map((n) => d.graph.nodes.find((m: KnowledgeNode) => m.id === n.id) || n) }));
        setFullGraph((g) => ({ ...g, nodes: g.nodes.map((n) => d.graph.nodes.find((m: KnowledgeNode) => m.id === n.id) || n) }));
      }).catch(() => undefined);
  }, [networks]);

  // 掌握度仪表盘:网络就绪后拉一次全部节点 progress,按网络聚合均值 + 最薄弱 3 节点
  useEffect(() => { refreshMastery(); }, [refreshMastery]);

  const switchNetwork = (id: string, focusId?: string) => {
    if (id === activeNetwork && !focusId) return;
    setActiveNetwork(id);
    setSelected(null);
    if (focusId) {
      // 跨网络提问聚焦:切网后聚焦目标节点
      fetch(`/api/knowledge-graph?network=${id}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } }).then((r) => r.json()).then((d) => {
        if (!d.graph) return;
        setFullGraph(d.graph); setCurrentGraph(d.graph); setCumulative({ nodes: [], edges: [] });
        mergeAllNodes(d.graph.nodes);
        const target = d.graph.nodes.find((n: KnowledgeNode) => n.id === focusId);
        setFocusIds(target ? [focusId] : d.graph.nodes.slice(0, 1).map((n: KnowledgeNode) => n.id));
      }).catch(() => undefined);
      return;
    }
    fetch(`/api/knowledge-graph?network=${id}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } }).then((r) => r.json()).then((d) => { if (!d.graph) return; setFullGraph(d.graph); setCurrentGraph(d.graph); setCumulative({ nodes: [], edges: [] }); mergeAllNodes(d.graph.nodes); setFocusIds(d.graph.nodes.slice(0, 1).map((n: KnowledgeNode) => n.id)); }).catch(() => undefined);
  };
  const ratioRef = useRef(ratio);
  useEffect(() => { ratioRef.current = ratio; }, [ratio]);
  // 对话持久化:消息或苏格拉底状态变化时写入 localStorage(跳过 pending)
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({
        messages: messages.filter((m) => !m.pending).slice(-100).map((m) => ({ ...m, concepts: m.concepts ? m.concepts.map((c) => ({ id: c.id, name: c.name })) : undefined })),
        socratic: { active: socraticActive, question: socraticQuestion, turn, hintLevel },
      }));
    } catch { /* 隐私模式/容量满忽略 */ }
  }, [messages, socraticActive, socraticQuestion, turn, hintLevel]);
  // 消息或加载状态变化时,若用户接近底部则自动滚动到底部(回读历史时不打断)
  useEffect(() => {
    const el = chatEndRef.current?.parentElement?.parentElement as HTMLElement | null;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (!nearBottom) return;
    const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chatEndRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [messages, loading]);
  useEffect(() => { const move = (e: PointerEvent) => { if (!dragging.current || !workspace.current) return; const rect = workspace.current.getBoundingClientRect(); const next = Math.min(62, Math.max(30, ((e.clientX - rect.left) / rect.width) * 100)); setRatio(next); }; const up = () => { if (dragging.current) { try { localStorage.setItem(STORAGE_KEY, String(ratioRef.current)); } catch { /* 隐私模式忽略 */ } } dragging.current = false; setResizing(false); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up); return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); }; }, []);

  const graph = fullGraph; // 完整图谱模式：始终显示全部节点，焦点只影响高亮与中心
  // 跨网络节点缓存:切换网络时累积,提问命中其他网络节点也能解析(id 前缀 = networkId)
  const allNodesRef = useRef<Map<string, KnowledgeNode>>(new Map());
  const mergeAllNodes = (nodes: KnowledgeNode[]) => { nodes.forEach((n) => allNodesRef.current.set(n.id, n)); };
  useEffect(() => { mergeAllNodes(fullGraph.nodes); }, [fullGraph]);
  const nodeForId = useCallback((id: string) => fullGraph.nodes.find((n) => n.id === id) || cumulative.nodes.find((n) => n.id === id) || allNodesRef.current.get(id), [cumulative.nodes, fullGraph.nodes]);
  const [pathCtx, setPathCtx] = useState<{ prereqs: KnowledgeNode[]; nexts: KnowledgeNode[]; suggestedNext: KnowledgeNode | null }>({ prereqs: [], nexts: [], suggestedNext: null });

  const setCurrentFromContext = (ctx: any) => {
    const focusId = ctx?.focusNode?.id;
    // 跨网络衔接:命中节点不在当前网络图内 → 自动切换到其所属网络并聚焦(提问不丢失)
    if (focusId && !fullGraph.nodes.find((n) => n.id === focusId) && !cumulative.nodes.find((n) => n.id === focusId)) {
      const netId = String(focusId).split(":")[0];
      if (networks.some((n) => n.id === netId)) {
        switchNetwork(netId, focusId);
        return [];
      }
    }
    const ids = [focusId, ...(ctx?.highlightNodeIds || []), ...(ctx?.prerequisites || []).map((n: KnowledgeNode) => n.id), ...(ctx?.relatedNodes || []).map((n: KnowledgeNode) => n.id), ...(ctx?.nextNodes || []).map((n: KnowledgeNode) => n.id)].filter(Boolean) as string[];
    const unique = [...new Set(ids)];
    // 完整图谱模式：不裁剪当前图，仅移动焦点中心；提问相关节点加入累计图
    const relatedNodes = unique.map(nodeForId).filter(Boolean) as KnowledgeNode[];
    setFocusIds(focusId ? [focusId] : unique.slice(0, 1));
    setCumulative((old) => mergeGraph(old, relatedNodes, fullGraph.edges.filter((e) => unique.includes(e.source) && unique.includes(e.target))));
    // 动态学习路径:前置/后续/推荐下一步(供侧栏步骤条与推荐卡片)
    setPathCtx({
      prereqs: (ctx?.prerequisites || []).map(nodeForId).filter(Boolean) as KnowledgeNode[],
      nexts: (ctx?.nextNodes || []).map(nodeForId).filter(Boolean) as KnowledgeNode[],
      suggestedNext: ctx?.suggestedNextNode?.id ? (nodeForId(ctx.suggestedNextNode.id) as KnowledgeNode | null) : null,
    });
    return unique;
  };

  const send = async (value = input) => {
    const text = value.trim(); if (!text || loading) return; abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller; const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const mySeq = ++reqSeqRef.current;
    const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
    setInput(""); setLoading(true);
    if (!socraticActive) {
      // 新问题 → 苏格拉底式启动：不直接给答案，先引导提问
      setMessages((old) => [...old, { id: `${requestId}-q`, role: "user", content: text }, { id: `${requestId}-a`, role: "assistant", content: "正在结合课程知识图谱组织引导问题…", pending: true }]);
      try {
        const res = await fetch("/api/agent", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ action: "guided_socratic_start", params: { question: text } }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error || "引导服务暂时不可用");
        if (mySeq !== reqSeqRef.current) return; // 新对话已清空,丢弃迟到响应
        const ids = data.graphContext ? setCurrentFromContext(data.graphContext) : []; const concepts = ids.map(nodeForId).filter(Boolean) as KnowledgeNode[];
        setSocraticActive(true); setSocraticQuestion(text); setTurn(1); setHintLevel(0);
        setMessages((old) => old.map((m) => m.id === `${requestId}-a` ? { ...m, content: data.greeting || "让我们一步步来思考这个问题。", pending: false, nodeIds: ids, concepts, kind: "answer" } : m));
      } catch (e) { if ((e as Error).name !== "AbortError") setMessages((old) => old.map((m) => m.id === `${requestId}-a` ? { ...m, content: (e as Error).message || "网络错误，请重试", pending: false, error: true } : m)); else setMessages((old) => old.map((m) => m.id === `${requestId}-a` ? { ...m, content: "已停止生成。你可以重新提问或继续。", pending: false, kind: "info" } : m)); }
    } else {
      // 追问轮次中：学生回答 → 苏格拉底式评估
      setMessages((old) => [...old, { id: `${requestId}-q`, role: "user", content: text }, { id: `${requestId}-a`, role: "assistant", content: "正在评估你的回答并继续引导…", pending: true }]);
      try {
        const res = await fetch("/api/agent", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ action: "guided_socratic_turn", params: { question: socraticQuestion, answer: text, turn, history } }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error || "引导服务暂时不可用");
        if (mySeq !== reqSeqRef.current) return; // 新对话已清空,丢弃迟到响应
        const ids = data.graphContext ? setCurrentFromContext(data.graphContext) : []; const concepts = ids.map(nodeForId).filter(Boolean) as KnowledgeNode[];
        const kind = data.status === "complete" ? "final" : (data.status === "mastered" ? "info" : "answer");
        if (data.status === "complete" || data.status === "mastered") { setSocraticActive(false); setSocraticQuestion(""); setTurn(0); setHintLevel(0); refreshMastery(); } // 收束后即时刷新掌握度(色阶/仪表盘联动)
        // 引导完成落库（仅事件上报，不改引导逻辑）：服务器此前对引导完成无任何记录
        if (data.status === "complete") {
          fetch("/api/learning-events", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ type: "GUIDED_COMPLETED", title: "完成一轮引导学习", summary: (socraticQuestion || "").slice(0, 100), refType: "guided" }) }).catch(() => {});
        }
        else setTurn((t) => Math.min(MAX_TURNS, t + 1));
        setMessages((old) => old.map((m) => m.id === `${requestId}-a` ? { ...m, content: data.response || "继续思考一下，你离答案很近了。", pending: false, nodeIds: ids, concepts, kind } : m));
      } catch (e) { if ((e as Error).name !== "AbortError") setMessages((old) => old.map((m) => m.id === `${requestId}-a` ? { ...m, content: (e as Error).message || "网络错误，请重试", pending: false, error: true } : m)); else setMessages((old) => old.map((m) => m.id === `${requestId}-a` ? { ...m, content: "已停止生成。你可以继续回答或提出新问题。", pending: false, kind: "info" } : m)); }
    }
    if (mySeq === reqSeqRef.current) { if (abortRef.current === controller) abortRef.current = null; setLoading(false); }
  };

  const requestHint = async () => {
    if (loading || !socraticActive || hintLevel >= MAX_HINTS) return;
    const mySeq = ++reqSeqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    const level = hintLevel + 1; setLoading(true); const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
    setMessages((old) => [...old, { id: `${requestId}-h`, role: "assistant", content: `正在生成第 ${level} 级提示…`, pending: true, kind: "hint" }]);
    try {
      const res = await fetch("/api/agent", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ action: "guided_socratic_hint", params: { question: socraticQuestion, level, history } }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error || "提示服务暂时不可用");
      if (mySeq !== reqSeqRef.current) return; // 新对话已清空,丢弃迟到提示响应
      setHintLevel(level);
      setMessages((old) => old.map((m) => m.id === `${requestId}-h` ? { ...m, content: `💡 第 ${level}/${MAX_HINTS} 级提示：${data.hint || "想一想课程中相关的概念。"}`, pending: false } : m));
    } catch (e) { if ((e as Error).name !== "AbortError") setMessages((old) => old.map((m) => m.id === `${requestId}-h` ? { ...m, content: (e as Error).message || "提示获取失败，请重试", pending: false, error: true } : m)); else setMessages((old) => old.map((m) => m.id === `${requestId}-h` ? { ...m, content: "已停止生成提示。", pending: false, kind: "info" } : m)); }
    if (mySeq === reqSeqRef.current) { if (abortRef.current === controller) abortRef.current = null; setLoading(false); }
  };

  const resetSocratic = () => { setSocraticActive(false); setSocraticQuestion(""); setTurn(0); setHintLevel(0); setMessages((old) => [...old, { id: `reset-${Date.now()}`, role: "assistant", content: "本轮引导已结束。你可以提出一个新的问题继续学习。", kind: "info" }]); };

  const askAbout = (node: KnowledgeNode) => { setSelected(node); setInput(`请解释“${node.name}”，并说明它与城市排水和内涝防治的关系。`); setMobileTab("chat"); };
  const expand = (node: KnowledgeNode) => { const related = fullGraph.edges.filter((e) => e.source === node.id || e.target === node.id).flatMap((e) => [e.source, e.target]).filter((id) => id !== node.id); const ids = [...new Set([...focusIds, node.id, ...related])]; setFocusIds(ids); setCumulative((old) => mergeGraph(old, ids.map(nodeForId).filter(Boolean) as KnowledgeNode[], fullGraph.edges.filter((e) => ids.includes(e.source) && ids.includes(e.target)))); };
  const fullscreen = async () => { const el = workspace.current?.querySelector("[aria-label='交互式知识图谱']")?.parentElement; if (!document.fullscreenElement) await el?.requestFullscreen?.(); else await document.exitFullscreen(); };
  const graphForMessage = (m: ChatMessage) => { if (!m.nodeIds?.length) return; setFocusIds(m.nodeIds.slice(0, 1)); setMode("current"); setMobileTab("graph"); };
  const copyMsg = async (content: string) => { try { await navigator.clipboard.writeText(content); } catch { /* 剪贴板不可用时静默 */ } };
  const newChat = () => {
    if (messages.length === 0) return;
    if (!window.confirm("确定清空当前对话并重新开始吗？此操作不可撤销。")) return;
    abortRef.current?.abort(); abortRef.current = null; reqSeqRef.current++; // 中止飞行中请求,防止旧响应复活状态
    setLoading(false); setMessages([]); setSocraticActive(false); setSocraticQuestion(""); setTurn(0); setHintLevel(0); setSelected(null); setInput("");
    try { localStorage.removeItem(CHAT_STORAGE_KEY); } catch { /* 隐私模式忽略 */ }
  };
  const exportChat = () => {
    if (messages.length === 0) return;
    const lines = [`# 引导学习对话记录`, ``, `> 苏格拉底式引导 · 三轮追问 · 四级提示`, `> 导出时间: ${new Date().toLocaleString("zh-CN")}`, ``];
    messages.forEach((m) => {
      if (m.pending) return;
      if (m.role === "user") { lines.push(`## 🧑‍🎓 我`); lines.push(""); lines.push(m.content); lines.push(""); }
      else {
        const tag = m.kind === "hint" ? "💡 提示" : m.kind === "final" ? "✅ 讲解" : m.kind === "info" ? "📌 说明" : "🤖 引导";
        lines.push(`## ${tag}`); lines.push(""); lines.push(m.content); lines.push("");
      }
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `引导学习-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    // 延迟回收 Blob URL,避免 Safari/WebView 下载被中断
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const selectedNeighbors = selected ? fullGraph.edges.filter((e) => e.source === selected.id || e.target === selected.id).map((e) => nodeForId(e.source === selected.id ? e.target : e.source)).filter(Boolean) as KnowledgeNode[] : [];

  if (state.authLoading) return <div className="p-8 text-center">正在加载学习空间…</div>;
  if (!state.role) return <div className="p-8 text-center">请先登录后进入引导学习。</div>;
  return <div className="h-[calc(100vh-3.5rem)] min-h-[620px] bg-gradient-to-br from-slate-100 via-blue-50/60 to-slate-100 p-3 md:p-4"><div className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-xl shadow-slate-200/50 backdrop-blur transition-shadow duration-500 hover:shadow-2xl hover:shadow-slate-300/40"><header className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-gradient-to-r from-white via-blue-50/40 to-white px-4 py-3"><div><h1 className="bg-gradient-to-r from-slate-900 to-blue-700 bg-clip-text text-base font-bold text-transparent">引导学习工作台</h1><p className="text-xs text-slate-500">苏格拉底式引导 · 三轮追问 · 四级提示</p>{socraticActive && <div className="mt-1.5 flex items-center gap-2 text-[11px]">{[1, 2, 3].map((r) => <span key={r} className={`pop-in rounded-full px-2 py-0.5 transition-all duration-300 ${r === turn ? "bg-blue-600 text-white shadow-md shadow-blue-200" : r < turn ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{r === 1 ? "① 识别问题" : r === 2 ? "② 建立联系" : "③ 形成答案"}</span>)}<span className="text-slate-400">提示 {hintLevel}/{MAX_HINTS}</span></div>}</div><div className="hidden gap-2 text-xs text-slate-500 md:flex"><span className="rounded-full border border-blue-100 bg-blue-50/80 px-3 py-1 text-blue-700 transition hover:bg-blue-100">累计 {cumulative.nodes.length} 个概念</span><span className="rounded-full border border-cyan-100 bg-cyan-50/80 px-3 py-1 text-cyan-700 transition hover:bg-cyan-100">💬 提问 {messages.filter((m) => m.role === "user").length} 次</span><span className="rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1 text-emerald-700 transition hover:bg-emerald-100">✅ 完成 {messages.filter((m) => m.kind === "final").length} 轮</span><span className="rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1 text-emerald-700 transition hover:bg-emerald-100">稳定布局</span><button onClick={exportChat} disabled={messages.length === 0} title="导出对话为 Markdown" className="rounded-full border border-violet-100 bg-violet-50/80 px-3 py-1 text-violet-700 transition hover:bg-violet-100 disabled:opacity-40">📥 导出对话</button><button onClick={newChat} disabled={messages.length === 0} title="清空当前对话重新开始" className="rounded-full border border-rose-100 bg-rose-50/80 px-3 py-1 text-rose-600 transition hover:bg-rose-100 disabled:opacity-40">🗑 新对话</button></div></header><div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-100 bg-white/80 px-3 py-1.5 backdrop-blur"><span className="mr-1 shrink-0 text-[11px] font-semibold text-slate-400">知识网络</span>{networks.map((n) => <button key={n.id} onClick={() => { if (expandAll) { setExpandAll(false); switchNetwork(n.id); } else switchNetwork(n.id); }} title={n.summary} className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-200 ${activeNetwork === n.id ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-200" : "border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"}`}>{n.chip}</button>)}{activeNetwork === "overview" && <button onClick={toggleExpandAll} title={`一次展示全部 ${networks.length} 个网络的 ${fullGraph?.nodes?.length ?? 0} 个知识点(可拖动/缩放/搜索定位)`} className={`ml-1 shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition-all duration-200 ${expandAll ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm shadow-emerald-200" : "border border-dashed border-emerald-400 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>{expandAll ? `🌐 收起(${fullGraph?.nodes?.length ?? 0} 节点总览)` : `🌐 全部展开(${fullGraph?.nodes?.length ?? 0} 节点)`}</button>}</div><div className="flex shrink-0 items-center gap-2.5 overflow-x-auto border-b border-slate-100 bg-white/70 px-3 py-1.5 backdrop-blur">{(masteryStats.length > 0 || weakList.length > 0) && <><span className="shrink-0 text-[11px] font-semibold text-slate-400">掌握度</span>{masteryStats.map((s) => <button key={s.networkId} onClick={() => switchNetwork(s.networkId)} title={`${s.studied}/${s.total} 个节点已学`} className="group flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 transition hover:border-blue-300"><span className="h-1.5 w-10 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${s.avg}%`, background: s.avg >= 50 ? "#17b97b" : s.avg > 0 ? "#3b82f6" : "#cbd5e1" }} /></span><span className="font-medium">{networks.find((n) => n.id === s.networkId)?.chip || s.networkId}</span><span className="text-slate-400">{s.avg}%</span></button>)}<span className="ml-1 flex shrink-0 items-center gap-1.5">{weakList.length > 0 && <><span className="text-[11px] font-semibold text-rose-400">最薄弱</span>{weakList.map((n) => <button key={n.id} onClick={() => switchNetwork(networkIdOf(n.id), n.id)} className="shrink-0 rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600 transition hover:bg-rose-100" title={`掌握度 ${n.progress?.mastery ?? "未学"}`}>{n.name}</button>)}</>}</span></>}</div><div className="flex border-b border-slate-100 bg-white/70 backdrop-blur md:hidden"><button onClick={() => setMobileTab("graph")} className={`flex-1 py-2 text-sm transition-all duration-300 ${mobileTab === "graph" ? "border-b-2 border-blue-600 bg-blue-50/50 text-blue-700" : "text-slate-500 hover:bg-slate-50"}`}>知识图谱</button><button onClick={() => setMobileTab("chat")} className={`flex-1 py-2 text-sm transition-all duration-300 ${mobileTab === "chat" ? "border-b-2 border-blue-600 bg-blue-50/50 text-blue-700" : "text-slate-500 hover:bg-slate-50"}`}>AI 对话</button></div><div ref={workspace} className="min-h-0 flex-1 md:grid" style={{ gridTemplateColumns: graphCollapsed ? "0 1fr" : `${ratio}% 1fr`, transition: resizing ? "none" : "grid-template-columns 0.4s cubic-bezier(0.4, 0, 0.2, 1)" }}>
    <section className={`relative min-h-0 overflow-hidden border-r ${mobileTab === "graph" ? "block" : "hidden md:block"}`} style={{ background: "linear-gradient(180deg, #fbfdff 0%, #f6f8fc 45%, #f2f6fb 100%)" }}><KnowledgeGraphPanel graph={graph} focusIds={focusIds} selectedNodeId={selected?.id} depth={depth} mode={mode} nodeCategory={nodeCategory} relationType={relationType} onModeChange={setMode} onDepthChange={setDepth} onNodeClick={(n) => { // 总览网络:章节节点点击跳转到对应专题网络
          const sec = (networks.find(x => x.id === activeNetwork)?.sections || []).find(s => s.full === n.name || s.label === n.name);
          if (sec?.target) { switchNetwork(sec.target); return; }
          setSelected(n); setFocusIds([n.id]); }} onAsk={askAbout} onExpand={expand} onCollapse={() => setGraphCollapsed(true)} onFullscreen={fullscreen} onCollapsePanel={() => setGraphCollapsed(true)} {...({ onNodeCategory: setNodeCategory, onRelationType: setRelationType } as any)} />{selected && <aside className="slide-in-right absolute right-3 top-20 z-20 flex max-h-[calc(100%-120px)] w-[min(330px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 text-slate-900 shadow-2xl shadow-slate-300/40 backdrop-blur"><div className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-white to-blue-50/50 p-4"><div><div className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">{selected.category} · {selected.chapter || "未配置章节"}</div><h2 className="mt-1 text-base font-bold">{selected.name}</h2></div><button onClick={() => setSelected(null)} aria-label="关闭节点详情" className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">×</button></div><div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs"><p className="leading-5 text-slate-600">{selected.description || "暂无详细定义"}</p><div className="rounded-xl bg-gradient-to-br from-slate-50 to-blue-50/40 p-3"><div className="font-semibold">学习状态</div><div className="mt-2 text-slate-500">掌握度 {selected.progress?.mastery ?? 0}% · 提问 {selected.progress?.questionCount ?? 0} 次</div></div><div><div className="mb-2 font-semibold">先修与相关知识</div><div className="flex flex-wrap gap-1.5">{selectedNeighbors.slice(0, 8).map((n) => <button key={n.id} onClick={() => { setSelected(n); setFocusIds([n.id]); }} className="rounded-full border border-slate-200 px-2 py-1 text-[11px] transition-all duration-150 hover:-translate-y-0.5 hover:border-blue-400 hover:text-blue-600 hover:shadow-sm">{n.name}</button>)}</div></div><div><div className="mb-2 font-semibold">学习路径</div><div className="space-y-2">{pathCtx.suggestedNext && <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-2.5"><div className="text-[10px] font-semibold uppercase tracking-wide text-blue-500">推荐下一步</div><button onClick={() => { setSelected(pathCtx.suggestedNext); setFocusIds([pathCtx.suggestedNext!.id]); }} className="mt-1 text-left text-[11px] font-semibold text-blue-700 hover:underline">{pathCtx.suggestedNext.name} →</button></div>}<div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-emerald-100 bg-emerald-50/80 p-2.5 text-emerald-800">{(pathCtx.prereqs.length ? pathCtx.prereqs : []).map((n, i) => <Fragment key={n.id}>{i > 0 && <span className="text-emerald-400">→</span>}<button onClick={() => { setSelected(n); setFocusIds([n.id]); }} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 shadow-sm hover:bg-emerald-100">{n.name}</button></Fragment>)}{pathCtx.prereqs.length > 0 && <span className="text-emerald-400">→</span>}<span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">{selected.name}</span>{pathCtx.nexts.slice(0, 3).map((n) => <Fragment key={n.id}><span className="text-emerald-400">→</span><button onClick={() => { setSelected(n); setFocusIds([n.id]); }} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 shadow-sm hover:bg-emerald-100">{n.name}</button></Fragment>)}</div></div></div></div><div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3"><button onClick={() => askAbout(selected)} className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-2 py-2 text-xs text-white shadow-sm shadow-blue-200 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0">围绕此概念提问</button><button onClick={() => expand(selected)} className="rounded-xl border border-slate-200 px-2 py-2 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm active:translate-y-0">展开邻居</button><button onClick={() => {
  fetch("/api/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify({ refType: "node", refId: selected.id, note: selected.name, inReview: true }),
  }).catch(() => {});
  setSelected(null);
}} className="rounded-xl border border-slate-200 px-2 py-2 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm">加入复习</button><button onClick={() => setSelected(null)} className="rounded-xl border border-slate-200 px-2 py-2 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm">标记已掌握</button></div></aside>}</section>
    {!graphCollapsed && <div role="separator" aria-label="调整图谱与对话宽度" tabIndex={0} onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); dragging.current = true; setResizing(true); }} onDoubleClick={() => { setRatio(42); try { localStorage.setItem(STORAGE_KEY, "42"); } catch { /* 隐私模式忽略 */ } }} onKeyDown={(e) => { if (e.key === "ArrowLeft") setRatio((v) => Math.max(30, v - 2)); if (e.key === "ArrowRight") setRatio((v) => Math.min(62, v + 2)); }} className="group relative z-10 hidden w-3 cursor-col-resize transition-colors duration-300 hover:bg-blue-100/60 md:block"><div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-slate-300 to-transparent transition-colors duration-300 group-hover:via-blue-400" /><span className="absolute left-1/2 top-1/2 flex h-7 w-1.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-slate-300 shadow-sm transition-all duration-300 group-hover:h-9 group-hover:bg-blue-500 group-hover:shadow-md" /></div>}
    <section className={`flex min-w-0 flex-col ${mobileTab === "chat" ? "flex" : "hidden md:flex"}`} style={{ background: "linear-gradient(180deg, #fbfdff 0%, #f8fafd 60%, #f3f6fb 100%)" }}>{graphCollapsed && <button onClick={() => setGraphCollapsed(false)} className="m-3 self-start rounded-lg border bg-white px-3 py-1.5 text-xs text-blue-700">展开知识图谱</button>}<div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6"><div className="mx-auto max-w-3xl space-y-4">{messages.length === 0 && <div className="py-10 text-center md:py-20"><div className="glow-breathe mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-2xl text-white shadow-lg shadow-blue-200">✦</div><h2 className="bg-gradient-to-r from-slate-900 to-blue-700 bg-clip-text text-lg font-bold text-transparent">从一个问题开始，我们一起思考</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">我不会直接告诉你答案——通过最多三轮追问和四级提示，引导你自己找到答案，并把相关概念呈现在左侧图谱上。</p><div className="mt-6 flex flex-wrap justify-center gap-2">{suggested.map((q) => <button key={q} onClick={() => send(q)} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:text-blue-700 hover:shadow-md active:translate-y-0">{q}</button>)}</div></div>}{messages.map((m, mi) => <article key={m.id} className={`msg-enter group ${m.role === "user" ? "justify-end" : ""} flex gap-2.5`} style={{ animationDelay: `${Math.min(mi, 3) * 0.06}s` }}>{m.role === "assistant" && <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-xs text-white shadow-sm">✦</div>}<div className={`relative max-w-[min(88%,720px)] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm transition-all duration-200 ${m.role === "user" ? "rounded-br-md bg-gradient-to-br from-blue-600 to-blue-500 text-white shadow-blue-200" : m.kind === "hint" ? "rounded-bl-md border border-amber-200 bg-amber-50/90 text-amber-900" : m.kind === "final" ? "rounded-bl-md border border-emerald-200 bg-emerald-50/90 text-emerald-900" : m.kind === "info" ? "rounded-bl-md border border-slate-200 bg-slate-50/90 text-slate-500" : "rounded-bl-md border border-slate-100 bg-white text-slate-700 shadow-slate-100"}`}>{m.role === "assistant" && <button onClick={() => copyMsg(m.content)} title="复制此消息" className="absolute -right-2 -top-2 hidden h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] text-slate-400 shadow-sm transition-all duration-150 hover:border-blue-300 hover:text-blue-600 group-hover:flex">⧉</button>}<div>{m.content}</div>{m.pending && <div className="mt-2 flex items-center gap-1 text-blue-500"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /><span className="ml-1 text-[10px] opacity-70">思考中</span></div>}{m.role === "assistant" && m.concepts?.length ? <div className="mt-3 border-t border-slate-100 pt-3"><div className="mb-2 text-xs font-semibold text-slate-500">本轮核心概念</div><div className="flex flex-wrap gap-1.5">{m.concepts.slice(0, 6).map((n) => <button key={n.id} onClick={() => { setSelected(n); setFocusIds([n.id]); }} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700 transition-all duration-150 hover:-translate-y-0.5 hover:bg-blue-100 hover:shadow-sm">{n.name}</button>)}</div><button onClick={() => graphForMessage(m)} className="mt-3 text-xs text-blue-600 underline-offset-2 transition hover:text-blue-800 hover:underline">查看本轮知识路径 →</button></div> : null}</div></article>)}<div ref={chatEndRef} /></div></div><div className="shrink-0 border-t border-slate-100 bg-gradient-to-b from-white to-slate-50/80 p-3 md:p-4"><div className="mx-auto flex max-w-3xl items-end gap-2"><textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={socraticActive ? "输入你的思考/回答…（结束后可提出新问题）" : "输入你想学习的问题…（Enter 发送，Shift+Enter 换行）"} rows={2} disabled={loading} className="min-h-[52px] flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition-all duration-200 focus:border-blue-400 focus:shadow-md focus:shadow-blue-100 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100" />{socraticActive && <button onClick={requestHint} disabled={loading || hintLevel >= MAX_HINTS} title={hintLevel >= MAX_HINTS ? "提示已用满" : "获取逐级提示"} className="shrink-0 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-3 text-xs font-medium text-amber-700 transition-all duration-200 hover:-translate-y-0.5 hover:bg-amber-100 hover:shadow-md disabled:opacity-40 disabled:hover:translate-y-0">💡 提示 {hintLevel}/{MAX_HINTS}</button>}{socraticActive && <button onClick={resetSocratic} disabled={loading} title="结束本轮引导" className="shrink-0 rounded-2xl border px-3 py-3 text-xs text-slate-500 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-sm disabled:opacity-40 disabled:hover:translate-y-0">结束</button>}<button onClick={() => send()} disabled={loading || !input.trim()} className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3 text-sm font-medium text-white shadow-md shadow-blue-200 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300 active:translate-y-0 disabled:opacity-40 disabled:hover:translate-y-0">{loading ? "生成中…" : socraticActive ? "回答" : "发送"}</button></div><div className="mx-auto mt-2 flex max-w-3xl items-center justify-between text-[10px] text-slate-400"><span className="flex items-center gap-1.5">{socraticActive ? `苏格拉底引导中 · 第 ${turn}/${MAX_TURNS} 轮追问 · 提示 ${hintLevel}/${MAX_HINTS}` : focusIds.length ? `当前聚焦：${focusIds.map((id) => nodeForId(id)?.name).filter(Boolean).join("、")}` : "提出一个问题，我会用追问引导你思考"}</span>{loading && <button onClick={() => abortRef.current?.abort()} className="text-blue-600 underline-offset-2 transition hover:underline">停止生成</button>}</div></div></section>
  </div></div></div>;
}
