"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "@/types";
import KnowledgeGraphSphere, { type SphereHandle } from "./KnowledgeGraphSphere";
import { Pause, Play } from "lucide-react";
import { neighborhood, relationExplanation } from "./guided/model";

type Props = { graph: KnowledgeGraph; focusIds?: string[]; selectedNodeId?: string; depth: 1 | 2; mode: "current" | "cumulative"; nodeCategory?: string; relationType?: string; onModeChange: (v: "current" | "cumulative") => void; onDepthChange: (v: 1 | 2) => void; onNodeCategory?: (v: string) => void; onRelationType?: (v: string) => void; onNodeClick: (n: KnowledgeNode) => void; onExpand: (n: KnowledgeNode) => void; onFullscreen: () => void; onCollapsePanel: () => void; onAsk?: (n: KnowledgeNode) => void; onCollapse?: () => void };

const KIND_META: Record<string, { label: string; color: string; tint: string }> = {
  core: { label: "核心概念", color: "#165dff", tint: "rgba(22,93,255,0.15)" },
  method: { label: "方法/算法", color: "#ff8b2d", tint: "rgba(255,139,45,0.16)" },
  goal: { label: "学习目标", color: "#17b97b", tint: "rgba(23,185,123,0.16)" },
  factor: { label: "影响因素", color: "#8a63ff", tint: "rgba(138,99,255,0.16)" },
  benefit: { label: "应用/效益", color: "#ef4d9b", tint: "rgba(239,77,155,0.16)" },
};
const DEFAULT_KIND = { label: "章节/类别", color: "#18b8d8", tint: "rgba(24,184,216,0.16)" };
const rels: Record<string, string> = { prerequisite: "先修", leads_to: "推导", related: "相关", applied_in: "应用", governed_by: "依据" };



export default function KnowledgeGraphPanel(p: Props) {
  const sphere = useRef<SphereHandle>(null);
  const [query, setQuery] = useState("");
  const [labels, setLabels] = useState(false);
  const [legend, setLegend] = useState(false);
  const [rotating, setRotating] = useState(true);
  const [hover, setHover] = useState<KnowledgeNode | null>(null);
  const [branch, setBranch] = useState<string[]>([]);
  const [relation, setRelation] = useState<KnowledgeEdge | null>(null);
  const graphKey = p.graph.nodes.map(n => n.id).join("\0");
  useEffect(() => { setBranch([]); setRelation(null); setHover(null); }, [graphKey]);
  const fit = useCallback((ids?: string[], _force = false) => sphere.current?.fit(ids), []);
  const selectedId = p.selectedNodeId;
  const branchIds = useMemo(() => branch.length ? neighborhood(p.graph, [branch.at(-1)!], p.depth) : null, [branch, p.graph, p.depth]);

  const visible = useMemo(() => {
    // 完整图谱模式:默认显示全部节点;搜索/节点类型/关系类型仍可过滤
    const q = query.trim().toLowerCase();
    const matches = p.graph.nodes.filter(n => `${n.name} ${n.description} ${n.keywords.join(" ")}`.toLowerCase().includes(q));
    const searchIds = q ? neighborhood(p.graph, matches.map(n => n.id), 1) : null;
    const nodes = p.graph.nodes.filter((n) => (!branchIds || branchIds.has(n.id)) && (!searchIds || searchIds.has(n.id)) && (p.nodeCategory === "all" || !p.nodeCategory || (p.nodeCategory === "__other" ? !KIND_META[n.category] : n.category === p.nodeCategory)));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = p.graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target) && (p.relationType === "all" || !p.relationType || e.relation === p.relationType));
    return { nodes, edges };
  }, [p.graph, p.nodeCategory, p.relationType, query, branchIds]);

  const kindOf = (n: KnowledgeNode) => {
    // 掌握度色阶:已学过(有 progress)按掌握度变色——≥50 已掌握(绿)/<50 学习中(蓝);未学保持原分类色
    if (n.progress?.mastery !== undefined) {
      const color = n.progress.mastery >= 50 ? "#17b97b" : "#3b82f6";
      return { label: `掌握度 ${n.progress.mastery}%`, color, tint: color + "22" };
    }
    // 支持按网络分色(全部展开模式):node.color 优先于 category 配色
    if (n.color) return { label: n.category, color: n.color, tint: n.color + "22" };
    return KIND_META[n.category] || DEFAULT_KIND;
  };
  const explore = (node: KnowledgeNode) => { setBranch(old => old.at(-1) === node.id ? old : [...old, node.id]); setRelation(null); setHover(null); p.onExpand(node); };
  const relationSource = relation && p.graph.nodes.find(n => n.id === relation.source);
  const relationTarget = relation && p.graph.nodes.find(n => n.id === relation.target);

  return (
    <div className="legacy-enhanced-graph relative flex h-full min-h-0 flex-col overflow-hidden" style={{ background: "radial-gradient(circle at 50% 42%, rgba(22,93,255,0.08), transparent 26%), radial-gradient(circle at 18% 18%, rgba(24,184,216,0.06), transparent 18%), radial-gradient(circle at 78% 72%, rgba(138,99,255,0.07), transparent 18%), linear-gradient(180deg, rgba(255,255,255,0.52), rgba(250,252,255,0.84))" }}>
      <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "linear-gradient(rgba(130,149,185,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(130,149,185,0.05) 1px, transparent 1px)", backgroundSize: "42px 42px", maskImage: "linear-gradient(180deg, rgba(0,0,0,0.75), rgba(0,0,0,0.06))" }} />
      <div className="relative z-10 flex flex-wrap items-center gap-2 border-b border-[rgba(105,126,165,0.12)] bg-white/80 px-3 py-2 backdrop-blur">
        <div className="flex min-w-[150px] flex-1 items-center rounded-full border border-[rgba(105,126,165,0.16)] bg-white px-3 py-1 shadow-sm">
          <span className="mr-1 text-slate-400">⌕</span>
          <input aria-label="搜索知识节点" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索节点或关键词" className="w-full bg-transparent py-1 text-xs outline-none" />
        </div>
        <button onClick={() => p.onModeChange("current")} className={`rounded-full px-3 py-1 text-xs font-medium shadow-sm transition ${p.mode === "current" ? "text-white" : "border border-[rgba(105,126,165,0.16)] bg-white text-[#314362] hover:shadow-md"}`} style={p.mode === "current" ? { background: "linear-gradient(135deg, #165dff, #5b34ff)" } : undefined}>当前问题</button>
        <button onClick={() => p.onModeChange("cumulative")} className={`rounded-full px-3 py-1 text-xs font-medium shadow-sm transition ${p.mode === "cumulative" ? "text-white" : "border border-[rgba(105,126,165,0.16)] bg-white text-[#314362] hover:shadow-md"}`} style={p.mode === "cumulative" ? { background: "linear-gradient(135deg, #165dff, #5b34ff)" } : undefined}>累计图谱</button>
        <button onClick={() => p.onDepthChange(1)} className={`rounded-full px-3 py-1 text-xs font-medium shadow-sm transition ${p.depth === 1 ? "bg-[#165dff] text-white" : "border border-[rgba(105,126,165,0.16)] bg-white text-[#314362] hover:shadow-md"}`}>一阶</button>
        <button onClick={() => p.onDepthChange(2)} className={`rounded-full px-3 py-1 text-xs font-medium shadow-sm transition ${p.depth === 2 ? "bg-[#165dff] text-white" : "border border-[rgba(105,126,165,0.16)] bg-white text-[#314362] hover:shadow-md"}`}>二阶</button>
        <button onClick={() => fit(p.focusIds, true)} title="对准当前焦点(若被筛选过滤则重置到全图)" className="rounded-full border border-[rgba(105,126,165,0.16)] bg-white px-3 py-1 text-xs font-medium text-[#314362] shadow-sm transition hover:shadow-md">适应视图</button>
        <button onClick={() => { sphere.current?.reset(); }} title="清空手动摆放,回到算法布局并适应视图" className="rounded-full border border-[rgba(105,126,165,0.16)] bg-white px-3 py-1 text-xs font-medium text-[#314362] shadow-sm transition hover:shadow-md">重置布局</button>
        <button onClick={() => setLabels((v) => !v)} className={`rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition ${labels ? "border-[rgba(22,93,255,0.2)] bg-[rgba(22,93,255,0.08)] text-[#2450a5]" : "border-[rgba(105,126,165,0.16)] bg-white text-[#314362]"}`}>关系标签</button>
        <button onClick={() => setLegend((v) => !v)} className={`rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition ${legend ? "border-[rgba(22,93,255,0.2)] bg-[rgba(22,93,255,0.08)] text-[#2450a5]" : "border-[rgba(105,126,165,0.16)] bg-white text-[#314362]"}`}>图例</button>
        <button onClick={p.onFullscreen} className="rounded-full border border-[rgba(105,126,165,0.16)] bg-white px-3 py-1 text-xs font-medium text-[#314362] shadow-sm transition hover:shadow-md">全屏</button>
        <button onClick={p.onCollapsePanel} className="rounded-full border border-[rgba(105,126,165,0.16)] bg-white px-3 py-1 text-xs font-medium text-[#314362] shadow-sm transition hover:shadow-md">折叠</button>
      </div>
      <div className="relative z-10 flex items-center gap-2 border-b border-[rgba(105,126,165,0.12)] bg-white/60 px-3 py-1.5 backdrop-blur">
        <select aria-label="节点类型筛选" value={p.nodeCategory || "all"} onChange={(e) => p.onNodeCategory?.(e.target.value)} className="rounded-full border border-[rgba(105,126,165,0.16)] bg-white px-2 py-1 text-[11px] text-[#314362] shadow-sm outline-none">
          <option value="all">全部节点</option>
          {Object.entries(KIND_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          <option value="__other">章节/类别</option>
        </select>
        <select aria-label="关系类型筛选" value={p.relationType || "all"} onChange={(e) => p.onRelationType?.(e.target.value)} className="rounded-full border border-[rgba(105,126,165,0.16)] bg-white px-2 py-1 text-[11px] text-[#314362] shadow-sm outline-none">
          <option value="all">全部关系</option>
          {Object.entries(rels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="ml-auto text-[11px] font-medium text-[#6f7e97]">{visible.nodes.length} 节点 · {visible.edges.length} 关系</span>
      </div>
      <div className="relative min-h-[360px] flex-1 cursor-grab overflow-hidden active:cursor-grabbing md:min-h-0" style={{ touchAction: "none" }} aria-label="交互式知识图谱">
        {(branch.length > 0 || selectedId) && <nav className="legacy-graph-navigation" aria-label="图谱探索路径">
          {branch.length > 0 && <><button onClick={() => { setBranch([]); setRelation(null); fit(undefined, true); }}>返回全图</button><button onClick={() => setBranch(old => old.slice(0, -1))}>上一层</button><span>{p.graph.nodes.find(n => n.id === branch.at(-1))?.name}</span></>}
          {selectedId && branch.at(-1) !== selectedId && <button onClick={() => { const node = p.graph.nodes.find(n => n.id === selectedId); if (node) explore(node); }}>探索此分支</button>}
        </nav>}
        <KnowledgeGraphSphere ref={sphere} graph={p.graph} visibleIds={visible.nodes.map(n => n.id)} edges={visible.edges}
          selectedId={p.selectedNodeId} focusIds={p.focusIds} rotating={rotating} labels={labels}
          color={node => kindOf(node).color} onSelect={p.onNodeClick} onExpand={explore} onHover={setHover} onRelation={setRelation} />
        <button type="button" onClick={() => setRotating(value => !value)} aria-label={rotating ? "暂停旋转" : "开始旋转"} title={rotating ? "暂停旋转" : "开始旋转"} aria-pressed={rotating}
          className="absolute bottom-3 right-3 z-30 flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-slate-50">
          {rotating ? <Pause size={15} /> : <Play size={15} />}
        </button>
        {relation && relationSource && relationTarget && <aside className="legacy-relation-card" aria-label="关系说明"><button aria-label="关闭关系说明" onClick={() => setRelation(null)}>×</button><h3>{relationSource.name} → {relationTarget.name}</h3><p>{relationExplanation(relation, relationSource, relationTarget)}</p><div className="legacy-mini-controls"><button onClick={() => p.onNodeClick(relationSource)}>查看起点</button><button onClick={() => p.onNodeClick(relationTarget)}>查看终点</button></div></aside>}
        {hover && (
          <div className="fade-in pointer-events-none absolute left-3 top-20 z-20 max-w-xs rounded-2xl border border-[rgba(105,126,165,0.14)] bg-white/95 p-4 text-xs shadow-xl backdrop-blur">
            <div className="text-base font-bold text-[#183b8f]">{hover.name}</div>
            <div className="mt-1 text-[11px] font-semibold" style={{ color: kindOf(hover).color }}>{kindOf(hover).label}</div>
            {hover.progress?.mastery !== undefined && <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-[#e8edf7]"><div className="h-full rounded-full" style={{ width: `${hover.progress.mastery}%`, background: hover.progress.mastery >= 50 ? "#17b97b" : "#3b82f6" }} /></div>}
            <p className="mt-2 leading-5 text-[#42506b]">{hover.description || "暂无定义"}</p>
            <div className="mt-2 text-[11px] text-[#6f7e97]">拖动节点 · 双击展开 · 点击查看详情</div>
          </div>
        )}
        {legend && (
          <div className="fade-in absolute bottom-9 left-3 z-20 rounded-2xl border border-[rgba(105,126,165,0.14)] bg-white/90 p-4 text-xs shadow-xl backdrop-blur">
            <div className="mb-2 font-bold text-[#183b8f]">图例</div>
            {Object.entries(KIND_META).map(([k, v]) => <div key={k} className="flex items-center gap-2 py-0.5 font-medium text-[#3f4e68]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: v.color, boxShadow: `0 0 0 4px ${v.tint}` }} />{v.label}</div>)}
            <div className="flex items-center gap-2 py-0.5 font-medium text-[#3f4e68]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: DEFAULT_KIND.color, boxShadow: `0 0 0 4px ${DEFAULT_KIND.tint}` }} />{DEFAULT_KIND.label}</div>
            <div className="mt-1 border-t border-[rgba(105,126,165,0.12)] pt-1.5"><div className="mb-1 font-semibold text-[#183b8f]">掌握度</div><div className="flex items-center gap-2 py-0.5 font-medium text-[#3f4e68]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#17b97b", boxShadow: "0 0 0 4px rgba(23,185,123,0.16)" }} />已掌握(≥50%)</div><div className="flex items-center gap-2 py-0.5 font-medium text-[#3f4e68]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3b82f6", boxShadow: "0 0 0 4px rgba(59,130,246,0.16)" }} />学习中(&lt;50%)</div><div className="py-0.5 text-[#6f7e97]">未学节点保持分类色 · 答对一轮或完成讲解后掌握度上升</div></div>
            <div className="mt-2 border-t border-[rgba(105,126,165,0.12)] pt-2 text-[#6f7e97]">箭头方向由边标签表示 · 双击展开</div>
          </div>
        )}
      </div>
      <div className="relative z-10 border-t border-[rgba(105,126,165,0.12)] bg-white/70 px-3 py-1.5 text-[10px] text-[#6f7e97] backdrop-blur">完整知识图谱</div>
    </div>
  );
}
