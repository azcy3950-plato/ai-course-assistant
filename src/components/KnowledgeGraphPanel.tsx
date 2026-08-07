"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeGraph, KnowledgeNode } from "@/types";

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

function hashString(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function seededOffset(seed: number, range: number) { const x = Math.sin(seed) * 10000; return (x - Math.floor(x) - 0.5) * 2 * range; }
function wrapLabel(label: string): string[] {
  if (!label) return [""];
  if (label.length <= 8) return [label];
  const lines: string[] = [];
  let remaining = label;
  while (remaining.length > 0) {
    const size = remaining.length > 12 ? 5 : remaining.length > 9 ? 4 : remaining.length;
    lines.push(remaining.slice(0, size));
    remaining = remaining.slice(size);
  }
  return lines.slice(0, 3);
}

type Placed = { node: KnowledgeNode; x: number; y: number; depth: number };

function computeLayout(nodes: KnowledgeNode[], edges: { source: string; target: string }[], rootId: string | undefined, depth: 1 | 2, width: number, height: number): Placed[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const minSize = Math.min(width, height);
  const adj = new Map<string, Set<string>>();
  nodes.forEach((n) => adj.set(n.id, new Set()));
  edges.forEach((e) => { adj.get(e.source)?.add(e.target); adj.get(e.target)?.add(e.source); });
  const root = nodes.find((n) => n.id === rootId) || nodes[0];
  if (!root) return [];
  const placed = new Map<string, Placed>();
  placed.set(root.id, { node: root, x: centerX, y: centerY, depth: 0 });

  const ring1 = nodes.filter((n) => n.id !== root.id && adj.get(root.id)?.has(n.id));
  const ring1Ids = new Set(ring1.map((n) => n.id));
  const count1 = ring1.length || 1;
  const radius1 = minSize * 0.30;
  const startAngle = -Math.PI / 2;
  ring1.forEach((n, i) => {
    const angle = startAngle + (Math.PI * 2 * i) / count1;
    const wobble = seededOffset(hashString(n.id), minSize * 0.014);
    placed.set(n.id, { node: n, x: centerX + Math.cos(angle) * radius1 + wobble, y: centerY + Math.sin(angle) * radius1 + wobble * 0.65, depth: 1 });
  });

  if (depth === 2) {
    ring1.forEach((parent) => {
      const parentPlaced = placed.get(parent.id);
      if (!parentPlaced) return;
      const children = nodes.filter((n) => n.id !== root.id && !ring1Ids.has(n.id) && !placed.has(n.id) && adj.get(parent.id)?.has(n.id));
      if (!children.length) return;
      const spread = Math.min(Math.PI * 0.9, 0.40 + children.length * 0.13);
      const radius2 = minSize * 0.16;
      const arcStart = (Math.atan2(parentPlaced.y - centerY, parentPlaced.x - centerX)) - spread / 2;
      children.forEach((child, ci) => {
        const t = children.length === 1 ? 0.5 : ci / (children.length - 1);
        const angle = arcStart + spread * t;
        const jx = seededOffset(hashString(child.id) + 11, minSize * 0.010);
        const jy = seededOffset(hashString(child.id) + 37, minSize * 0.010);
        placed.set(child.id, { node: child, x: parentPlaced.x + Math.cos(angle) * radius2 + jx, y: parentPlaced.y + Math.sin(angle) * radius2 + jy, depth: 2 });
      });
    });
    const orphans = nodes.filter((n) => !placed.has(n.id));
    const countO = orphans.length || 1;
    const radiusO = minSize * 0.42;
    orphans.forEach((n, i) => {
      const angle = startAngle + (Math.PI * 2 * i) / countO;
      const wobble = seededOffset(hashString(n.id) + 5, minSize * 0.012);
      placed.set(n.id, { node: n, x: centerX + Math.cos(angle) * radiusO + wobble, y: centerY + Math.sin(angle) * radiusO + wobble * 0.6, depth: 2 });
    });
  } else {
    const orphans = nodes.filter((n) => !placed.has(n.id));
    const countO = orphans.length || 1;
    const radiusO = minSize * 0.42;
    orphans.forEach((n, i) => {
      const angle = startAngle + (Math.PI * 2 * i) / countO;
      const wobble = seededOffset(hashString(n.id) + 5, minSize * 0.012);
      placed.set(n.id, { node: n, x: centerX + Math.cos(angle) * radiusO + wobble, y: centerY + Math.sin(angle) * radiusO + wobble * 0.6, depth: 1 });
    });
  }
  return [...placed.values()];
}

function buildPath(sx: number, sy: number, tx: number, ty: number) {
  const dx = tx - sx, dy = ty - sy;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const midX = (sx + tx) / 2, midY = (sy + ty) / 2;
  const normalX = -dy / distance, normalY = dx / distance;
  const bend = Math.min(32, distance * 0.12);
  const controlX = midX + normalX * bend, controlY = midY + normalY * bend;
  return `M ${sx} ${sy} Q ${controlX} ${controlY} ${tx} ${ty}`;
}

export default function KnowledgeGraphPanel(p: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [query, setQuery] = useState("");
  const [labels, setLabels] = useState(true);
  const [legend, setLegend] = useState(false);
  const [hover, setHover] = useState<KnowledgeNode | null>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef<{ startX: number; startY: number; tx: number; ty: number; active: boolean; moved: boolean }>({ startX: 0, startY: 0, tx: 0, ty: 0, active: false, moved: false });

  const visible = useMemo(() => {
    const focus = new Set(p.focusIds || []);
    const ids = new Set<string>();
    if (!focus.size) p.graph.nodes.slice(0, 8).forEach((n) => ids.add(n.id));
    else {
      focus.forEach((id) => ids.add(id));
      p.graph.edges.forEach((e) => { if (focus.has(e.source) || focus.has(e.target)) { ids.add(e.source); ids.add(e.target); } });
      if (p.depth === 2) p.graph.edges.forEach((e) => { if (ids.has(e.source) || ids.has(e.target)) { ids.add(e.source); ids.add(e.target); } });
    }
    const q = query.trim().toLowerCase();
    const nodes = p.graph.nodes.filter((n) => ids.has(n.id) && (p.nodeCategory === "all" || !p.nodeCategory || (p.nodeCategory === "__other" ? !KIND_META[n.category] : n.category === p.nodeCategory)) && (!q || `${n.name} ${n.description} ${n.keywords.join(" ")}`.toLowerCase().includes(q)));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = p.graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target) && (p.relationType === "all" || !p.relationType || e.relation === p.relationType));
    return { nodes, edges };
  }, [p.depth, p.focusIds, p.graph, p.nodeCategory, p.relationType, query]);

  const placed = useMemo(() => {
    const w = 1400, h = 900;
    return computeLayout(visible.nodes, visible.edges, p.focusIds?.[0] || p.selectedNodeId || visible.nodes[0]?.id, p.depth, w, h);
  }, [p.depth, p.focusIds, p.selectedNodeId, visible]);
  const placedById = useMemo(() => new Map(placed.map((pl) => [pl.node.id, pl])), [placed]);

  const fit = useCallback((ids?: string[]) => {
    const targets = ids && ids.length ? ids : placed.map((pl) => pl.node.id);
    const pts = targets.map((id) => placedById.get(id)).filter(Boolean) as Placed[];
    if (!pts.length) return;
    const W = 1400, H = 900;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach((pt) => { minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y); maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y); });
    const pad = 110;
    const scale = Math.min((W - pad * 2) / Math.max(60, maxX - minX), (H - pad * 2) / Math.max(60, maxY - minY), 1.3);
    const tx = W / 2 - ((minX + maxX) / 2) * scale;
    const ty = H / 2 - ((minY + maxY) / 2) * scale;
    setView({ scale: Math.max(0.15, scale), tx, ty });
  }, [placed, placedById]);

  // 仅在内容结构变化(focusIds 或节点数量)时重置视图,搜索/筛选导致的 visible 变化不覆盖用户手动视图
  const fitKey = `${p.focusIds?.join(",") || ""}|${visible.nodes.length}`;
  const fitKeyRef = useRef("");
  useEffect(() => {
    if (fitKeyRef.current === fitKey) return;
    fitKeyRef.current = fitKey;
    const t = window.setTimeout(() => fit(p.focusIds), 60);
    return () => window.clearTimeout(t);
  }, [fit, fitKey, p.focusIds]);

  // wheel zoom + pointer drag pan
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const renderScale = () => {
      const rect = el.getBoundingClientRect();
      return { rs: Math.min(rect.width / 1400, rect.height / 900) || 1, rect };
    };
    const toViewBox = (clientX: number, clientY: number) => {
      const { rs, rect } = renderScale();
      const offsetX = (rect.width - 1400 * rs) / 2;
      const offsetY = (rect.height - 900 * rs) / 2;
      return { vx: (clientX - rect.left - offsetX) / rs, vy: (clientY - rect.top - offsetY) / rs };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { vx, vy } = toViewBox(e.clientX, e.clientY);
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const scale = Math.min(3, Math.max(0.15, v.scale * factor));
        const k = scale / v.scale;
        return { scale, tx: vx - (vx - v.tx) * k, ty: vy - (vy - v.ty) * k };
      });
    };
    const onPointerDown = (e: PointerEvent) => { dragRef.current = { startX: e.clientX, startY: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty, active: true, moved: false }; };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      const { rs } = renderScale();
      if (Math.abs(e.clientX - dragRef.current.startX) + Math.abs(e.clientY - dragRef.current.startY) > 5) dragRef.current.moved = true;
      setView((v) => ({ ...v, tx: dragRef.current.tx + (e.clientX - dragRef.current.startX) / rs, ty: dragRef.current.ty + (e.clientY - dragRef.current.startY) / rs }));
    };
    const onPointerUp = () => { dragRef.current.active = false; };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => { el.removeEventListener("wheel", onWheel); el.removeEventListener("pointerdown", onPointerDown); window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp); window.removeEventListener("pointercancel", onPointerUp); };
  }, []);

  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const selectedId = p.selectedNodeId;
  const selectionIds = useMemo(() => {
    const set = new Set<string>();
    const selected = p.selectedNodeId;
    if (!selected) return set;
    set.add(selected);
    const direct = new Set<string>();
    visible.edges.forEach((e) => { if (e.source === selected) direct.add(e.target); if (e.target === selected) direct.add(e.source); });
    direct.forEach((id) => set.add(id));
    // 二阶邻居:与一阶节点相连、但非选中节点本身/一阶节点的节点
    visible.edges.forEach((e) => {
      if (direct.has(e.source) && !set.has(e.target)) set.add(e.target);
      if (direct.has(e.target) && !set.has(e.source)) set.add(e.source);
    });
    return set;
  }, [p.selectedNodeId, visible.edges]);
  const focusSet = useMemo(() => new Set(p.focusIds || []), [p.focusIds]);

  const kindOf = (n: KnowledgeNode) => KIND_META[n.category] || DEFAULT_KIND;
  const radiusOf = (depth: number) => (depth === 0 ? 36 : depth === 1 ? 25 : 19);
  const edgeFocus = (e: { source: string; target: string }) => (focusSet.has(e.source) && focusSet.has(e.target)) || (e.source === selectedId || e.target === selectedId);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden" style={{ background: "radial-gradient(circle at 50% 42%, rgba(22,93,255,0.08), transparent 26%), radial-gradient(circle at 18% 18%, rgba(24,184,216,0.06), transparent 18%), radial-gradient(circle at 78% 72%, rgba(138,99,255,0.07), transparent 18%), linear-gradient(180deg, rgba(255,255,255,0.52), rgba(250,252,255,0.84))" }}>
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
        <button onClick={() => fit(p.focusIds)} className="rounded-full border border-[rgba(105,126,165,0.16)] bg-white px-3 py-1 text-xs font-medium text-[#314362] shadow-sm transition hover:shadow-md">适应视图</button>
        <button onClick={() => fit()} className="rounded-full border border-[rgba(105,126,165,0.16)] bg-white px-3 py-1 text-xs font-medium text-[#314362] shadow-sm transition hover:shadow-md">重置布局</button>
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
      <div ref={hostRef} className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing" aria-label="交互式知识图谱">
        <svg ref={svgRef} className="h-full w-full" viewBox="0 0 1400 900" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="kgSoftGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="kgHoverGlow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
            <g>
              {visible.edges.map((e) => {
                const s = placedById.get(e.source), t = placedById.get(e.target);
                if (!s || !t) return null;
                const focused = edgeFocus(e);
                return <g key={e.id}>
                  <path d={buildPath(s.x, s.y, t.x, t.y)} fill="none" strokeLinecap="round" stroke={focused ? "rgba(22,93,255,0.40)" : "rgba(123,142,172,0.26)"} strokeWidth={focused ? 2.4 : 1.8} />
                  {labels && <text x={(s.x + t.x) / 2} y={(s.y + t.y) / 2 - 6} textAnchor="middle" fontSize="10" fill={focused ? "#2450a5" : "#6f7e97"} style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.85)", strokeWidth: 3, strokeLinejoin: "round", fontWeight: 600 }}>{e.label || rels[e.relation] || e.relation}</text>}
                </g>;
              })}
            </g>
            <g>
              {placed.map(({ node, x, y, depth }) => {
                const kind = kindOf(node);
                const isSelected = selectedId === node.id;
                const isFocus = focusSet.has(node.id);
                const isRelated = selectionIds.has(node.id);
                const dimmed = selectedId !== null && selectedId !== undefined && selectedId !== node.id && !isRelated;
                const radius = radiusOf(depth);
                const lines = wrapLabel(node.name);
                return <g key={node.id} transform={`translate(${x},${y})`} className={`node-shell${isSelected ? " selected" : ""}${dimmed ? " dimmed" : ""}`} style={{ opacity: dimmed ? 0.22 : 1, transition: "opacity .18s ease, transform .18s ease", cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); if (dragRef.current.moved) { dragRef.current.moved = false; return; } p.onNodeClick(node); }}
                  onDoubleClick={(e) => { e.stopPropagation(); p.onExpand(node); }}
                  onMouseEnter={() => setHover(node)}
                  onMouseLeave={() => setHover(null)}>
                  <circle cx="0" cy="0" r={radius} fill={kind.color} fillOpacity={depth === 0 ? 1 : 0.92} stroke="rgba(255,255,255,0.88)" strokeWidth={isSelected ? 3 : 2} filter={isSelected ? "url(#kgHoverGlow)" : "url(#kgSoftGlow)"} />
                  {isFocus && !isSelected && <circle cx="0" cy="0" r={radius + 7} fill="none" stroke={kind.color} strokeOpacity="0.35" strokeWidth="2" strokeDasharray="4 4" />}
                  <text className={`node-label ${depth === 0 ? "root" : depth === 2 ? "small" : ""}`} x="0" y={radius + 16} textAnchor="middle" fontSize={depth === 0 ? 13 : depth === 2 ? 11 : 12} fontWeight="700" fill={isSelected ? "#0f2d76" : "#30415f"} style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.78)", strokeWidth: 3, strokeLinejoin: "round", pointerEvents: "none" }}>
                    {lines.map((line, li) => <tspan key={li} x="0" dy={li === 0 ? 0 : "1.2em"}>{line}</tspan>)}
                  </text>
                </g>;
              })}
            </g>
          </g>
        </svg>
        {hover && (
          <div className="pointer-events-none absolute left-3 top-20 z-20 max-w-xs rounded-2xl border border-[rgba(105,126,165,0.14)] bg-white/95 p-4 text-xs shadow-xl backdrop-blur">
            <div className="text-base font-bold text-[#183b8f]">{hover.name}</div>
            <div className="mt-1 text-[11px] font-semibold" style={{ color: kindOf(hover).color }}>{kindOf(hover).label}</div>
            <p className="mt-2 leading-5 text-[#42506b]">{hover.description || "暂无定义"}</p>
            <div className="mt-2 text-[11px] text-[#6f7e97]">双击展开邻居 · 点击查看详情</div>
          </div>
        )}
        {legend && (
          <div className="absolute bottom-9 left-3 z-20 rounded-2xl border border-[rgba(105,126,165,0.14)] bg-white/90 p-4 text-xs shadow-xl backdrop-blur">
            <div className="mb-2 font-bold text-[#183b8f]">图例</div>
            {Object.entries(KIND_META).map(([k, v]) => <div key={k} className="flex items-center gap-2 py-0.5 font-medium text-[#3f4e68]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: v.color, boxShadow: `0 0 0 4px ${v.tint}` }} />{v.label}</div>)}
            <div className="flex items-center gap-2 py-0.5 font-medium text-[#3f4e68]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: DEFAULT_KIND.color, boxShadow: `0 0 0 4px ${DEFAULT_KIND.tint}` }} />{DEFAULT_KIND.label}</div>
            <div className="mt-2 border-t border-[rgba(105,126,165,0.12)] pt-2 text-[#6f7e97]">箭头方向由边标签表示 · 双击展开</div>
          </div>
        )}
      </div>
      <div className="relative z-10 border-t border-[rgba(105,126,165,0.12)] bg-white/70 px-3 py-1.5 text-[10px] text-[#6f7e97] backdrop-blur">滚轮缩放 · 拖动画布 · 点击选择 · 双击展开</div>
    </div>
  );
}
