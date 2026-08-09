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

/**
 * 多阶径向布局(完整图谱):根(焦点)居中,BFS 按连接层级分层,
 * 每层节点均匀分布在半径递增的圆环上;孤立/远层节点放最外环。
 */
function computeLayout(nodes: KnowledgeNode[], edges: { source: string; target: string }[], rootId: string | undefined, _depth: 1 | 2, width: number, height: number): Placed[] {
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

  // BFS 分层:按连接层级分配环半径,完整图所有节点都参与布局
  const layers: string[][] = [[root.id]];
  const visited = new Set([root.id]);
  const queue: Array<{ id: string; depth: number }> = [{ id: root.id, depth: 0 }];
  while (queue.length) {
    const { id, depth } = queue.shift()!;
    const nextDepth = depth + 1;
    if (!layers[nextDepth]) layers[nextDepth] = [];
    adj.get(id)?.forEach((neighbor) => {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        layers[nextDepth].push(neighbor);
        queue.push({ id: neighbor, depth: nextDepth });
      }
    });
  }
  // 孤立节点(与根无连接)归入最外层
  const far = nodes.filter((n) => !visited.has(n.id));
  if (far.length) layers[layers.length] = far.map((n) => n.id);

  const startAngle = -Math.PI / 2;
  layers.forEach((layer, layerIndex) => {
    if (layerIndex === 0) return; // 根已居中
    const count = layer.length || 1;
    const baseRadius = minSize * (0.26 + (layerIndex - 1) * 0.15);
    const radius = Math.min(baseRadius, minSize * 0.44);
    const wobbleRange = minSize * (layerIndex <= 2 ? 0.014 : 0.010);
    layer.forEach((id, i) => {
      const angle = startAngle + (Math.PI * 2 * i) / count + seededOffset(hashString(id) + 3, 0.18);
      const wobble = seededOffset(hashString(id), wobbleRange);
      placed.set(id, { node: nodes.find((n) => n.id === id)!, x: centerX + Math.cos(angle) * radius + wobble, y: centerY + Math.sin(angle) * radius + wobble * 0.65, depth: Math.min(layerIndex, 3) });
    });
  });
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
  const [viewAnim, setViewAnim] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; tx: number; ty: number; active: boolean; moved: boolean; nodeId: string | null; baseX: number; baseY: number }>({ startX: 0, startY: 0, tx: 0, ty: 0, active: false, moved: false, nodeId: null, baseX: 0, baseY: 0 });
  const clickTimer = useRef<number | null>(null);
  const [nodeDrag, setNodeDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);

  const visible = useMemo(() => {
    // 完整图谱模式:默认显示全部节点;搜索/节点类型/关系类型仍可过滤
    const q = query.trim().toLowerCase();
    const nodes = p.graph.nodes.filter((n) => (p.nodeCategory === "all" || !p.nodeCategory || (p.nodeCategory === "__other" ? !KIND_META[n.category] : n.category === p.nodeCategory)) && (!q || `${n.name} ${n.description} ${n.keywords.join(" ")}`.toLowerCase().includes(q)));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = p.graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target) && (p.relationType === "all" || !p.relationType || e.relation === p.relationType));
    return { nodes, edges };
  }, [p.graph, p.nodeCategory, p.relationType, query]);

  const placed = useMemo(() => {
    const w = 1400, h = 900;
    return computeLayout(visible.nodes, visible.edges, p.focusIds?.[0] || p.selectedNodeId || visible.nodes[0]?.id, p.depth, w, h);
  }, [p.depth, p.focusIds, p.selectedNodeId, visible]);
  const placedById = useMemo(() => new Map(placed.map((pl) => [pl.node.id, pl])), [placed]);
  const placedByIdRef = useRef(placedById);
  useEffect(() => { placedByIdRef.current = placedById; }, [placedById]);

  // 邻接表(用于节点拖拽的弹簧联动)
  const adj = useMemo(() => {
    const map = new Map<string, Set<string>>();
    visible.nodes.forEach((n) => map.set(n.id, new Set()));
    visible.edges.forEach((e) => { map.get(e.source)?.add(e.target); map.get(e.target)?.add(e.source); });
    return map;
  }, [visible.edges, visible.nodes]);

  // 节点拖拽时的弹簧位移:被拖节点 1.0,一阶邻居 0.38,二阶邻居 0.14
  const springOffsets = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    if (!nodeDrag) return out;
    out.set(nodeDrag.id, { x: nodeDrag.dx, y: nodeDrag.dy });
    const first = new Set<string>();
    adj.get(nodeDrag.id)?.forEach((nid) => first.add(nid));
    first.forEach((nid) => out.set(nid, { x: nodeDrag.dx * 0.38, y: nodeDrag.dy * 0.38 }));
    first.forEach((nid) => adj.get(nid)?.forEach((n2) => { if (n2 !== nodeDrag.id && !first.has(n2)) out.set(n2, { x: nodeDrag.dx * 0.14, y: nodeDrag.dy * 0.14 }); }));
    return out;
  }, [adj, nodeDrag]);

  const fit = useCallback((ids?: string[], force = false) => {
    if (!placed.length) return;
    const W = 1400, H = 900;
    // 完整图模式:缩放级别由全图决定(保持完整可见),中心对准焦点/指定节点
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    placed.forEach((pt) => { minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y); maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y); });
    const pad = 110;
    const scale = Math.min((W - pad * 2) / Math.max(60, maxX - minX), (H - pad * 2) / Math.max(60, maxY - minY), 1.15);
    const targets = ids && ids.length ? ids.map((id) => placedById.get(id)).filter(Boolean) as Placed[] : [];
    // 指定了焦点但全部被搜索/筛选过滤(不可见)时保持当前视图,不做无效重置(用户显式点击时 force=true 跳过)
    if (!force && ids && ids.length && targets.length === 0 && !placedById.has(ids[0])) return;
    const cx = targets.length ? targets.reduce((s, pt) => s + pt.x, 0) / targets.length : (minX + maxX) / 2;
    const cy = targets.length ? targets.reduce((s, pt) => s + pt.y, 0) / targets.length : (minY + maxY) / 2;
    const tx = W / 2 - cx * scale;
    const ty = H / 2 - cy * scale;
    setView({ scale: Math.max(0.15, scale), tx, ty });
    // 焦点切换时平滑移动视图中心(提问→跳到相关节点)
    setViewAnim(true);
    window.setTimeout(() => setViewAnim(false), 650);
  }, [placed, placedById]);

  // 仅在内容结构变化(focusIds、节点数或深度)时重置视图,搜索/筛选导致的 visible 变化不覆盖用户手动视图
  const fitKey = `${p.focusIds?.join(",") || ""}|${visible.nodes.length}|${p.depth}`;
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
    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      const nodeEl = (e.target as Element).closest?.("[data-node-id]");
      if (nodeEl) {
        // 节点拖拽(物理):capture 到节点自身,记录基准布局位置
        const nodeId = nodeEl.getAttribute("data-node-id") || "";
        const pl = placedByIdRef.current.get(nodeId);
        (nodeEl as Element).setPointerCapture(e.pointerId);
        dragRef.current = { startX: e.clientX, startY: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty, active: true, moved: false, nodeId, baseX: pl?.x ?? 0, baseY: pl?.y ?? 0 };
        setNodeDrag({ id: nodeId, dx: 0, dy: 0 });
      } else {
        // 画布平移
        el.setPointerCapture(e.pointerId);
        dragRef.current = { startX: e.clientX, startY: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty, active: true, moved: false, nodeId: null, baseX: 0, baseY: 0 };
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      const { rs } = renderScale();
      if (Math.abs(e.clientX - dragRef.current.startX) + Math.abs(e.clientY - dragRef.current.startY) > 5) dragRef.current.moved = true;
      if (dragRef.current.nodeId) {
        const dx = (e.clientX - dragRef.current.startX) / rs;
        const dy = (e.clientY - dragRef.current.startY) / rs;
        setNodeDrag({ id: dragRef.current.nodeId, dx, dy });
      } else {
        setView((v) => ({ ...v, tx: dragRef.current.tx + (e.clientX - dragRef.current.startX) / rs, ty: dragRef.current.ty + (e.clientY - dragRef.current.startY) / rs }));
      }
    };
    const onPointerUp = () => { if (dragRef.current.active) { dragRef.current.active = false; setNodeDrag(null); } };
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
  const focusSet = useMemo(() => new Set(p.focusIds || []), [p.focusIds]);

  // 完整图谱模式的高亮集合:焦点节点 + 一阶/二阶邻居(depth 控制范围),其余节点淡化但可见
  const relatedIds = useMemo(() => {
    const set = new Set<string>(focusSet);
    visible.edges.forEach((e) => {
      if (focusSet.has(e.source)) set.add(e.target);
      if (focusSet.has(e.target)) set.add(e.source);
    });
    if (p.depth === 2) {
      visible.edges.forEach((e) => {
        if (set.has(e.source) && !focusSet.has(e.target)) set.add(e.target);
        if (set.has(e.target) && !focusSet.has(e.source)) set.add(e.source);
      });
    }
    return set;
  }, [focusSet, p.depth, visible.edges]);

  // 选中节点的相关集合(点击高亮)
  const selectionIds = useMemo(() => {
    const set = new Set<string>();
    const selected = p.selectedNodeId;
    if (!selected) return set;
    set.add(selected);
    const direct = new Set<string>();
    visible.edges.forEach((e) => { if (e.source === selected) direct.add(e.target); if (e.target === selected) direct.add(e.source); });
    direct.forEach((id) => set.add(id));
    visible.edges.forEach((e) => {
      if (direct.has(e.source) && !set.has(e.target)) set.add(e.target);
      if (direct.has(e.target) && !set.has(e.source)) set.add(e.source);
    });
    return set;
  }, [p.selectedNodeId, visible.edges]);

  const kindOf = (n: KnowledgeNode) => KIND_META[n.category] || DEFAULT_KIND;
  const radiusOf = (depth: number) => (depth === 0 ? 36 : depth === 1 ? 25 : 19);
  const edgeFocus = (e: { source: string; target: string }) => (relatedIds.has(e.source) && relatedIds.has(e.target)) || (e.source === selectedId || e.target === selectedId);

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
        <button onClick={() => fit(p.focusIds, true)} title="对准当前焦点(若被筛选过滤则重置到全图)" className="rounded-full border border-[rgba(105,126,165,0.16)] bg-white px-3 py-1 text-xs font-medium text-[#314362] shadow-sm transition hover:shadow-md">适应视图</button>
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
          <g style={{ transition: viewAnim ? "transform .65s cubic-bezier(0.22, 0.61, 0.36, 1)" : "none", transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}>
            <g>
              {visible.edges.map((e) => {
                const s = placedById.get(e.source), t = placedById.get(e.target);
                if (!s || !t) return null;
                const focused = edgeFocus(e);
                return <g key={e.id}>
                  <path d={buildPath(s.x, s.y, t.x, t.y)} fill="none" strokeLinecap="round" stroke={focused ? "rgba(22,93,255,0.40)" : "rgba(123,142,172,0.26)"} strokeWidth={focused ? 2.4 : 1.8} style={{ transition: "stroke .25s ease, stroke-width .25s ease" }} />
                  {labels && <text x={(s.x + t.x) / 2} y={(s.y + t.y) / 2 - 6} textAnchor="middle" fontSize="10" fill={focused ? "#2450a5" : "#6f7e97"} style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.85)", strokeWidth: 3, strokeLinejoin: "round", fontWeight: 600, transition: "fill .25s ease" }}>{e.label || rels[e.relation] || e.relation}</text>}
                </g>;
              })}
            </g>
            <g>
              {placed.map(({ node, x, y, depth }) => {
                const kind = kindOf(node);
                const isSelected = selectedId === node.id;
                const isFocus = focusSet.has(node.id);
                const isRelated = selectionIds.has(node.id) || relatedIds.has(node.id);
                // 完整图模式:选中节点时其余淡化;未选中时仅焦点范围外轻微淡化(仍可见)
                const dimmed = selectedId !== null && selectedId !== undefined ? (selectedId !== node.id && !selectionIds.has(node.id)) : (focusSet.size > 0 && !isRelated);
                const spring = springOffsets.get(node.id);
                const fx = spring ? x + spring.x : x;
                const fy = spring ? y + spring.y : y;
                const radius = radiusOf(depth);
                const lines = wrapLabel(node.name);
                return <g key={node.id} data-node-id={node.id} className={`node-shell${isSelected ? " selected" : ""}${dimmed ? " dimmed" : ""}`} style={{ opacity: dimmed ? 0.45 : 1, transition: "opacity .3s ease, transform .55s cubic-bezier(0.22, 0.61, 0.36, 1)", cursor: "grab", transform: `translate(${fx}px, ${fy}px)` }}
                  onClick={(e) => { e.stopPropagation(); if (dragRef.current.moved) { dragRef.current.moved = false; return; } if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; return; } clickTimer.current = window.setTimeout(() => { clickTimer.current = null; p.onNodeClick(node); }, 220); }}
                  onDoubleClick={(e) => { e.stopPropagation(); if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; } p.onExpand(node); }}
                  onMouseEnter={() => setHover(node)}
                  onMouseLeave={() => setHover(null)}>
                  <circle cx="0" cy="0" r={radius} fill={kind.color} fillOpacity={depth === 0 ? 1 : 0.92} stroke="rgba(255,255,255,0.88)" strokeWidth={isSelected ? 3 : 2} filter={isSelected ? "url(#kgHoverGlow)" : "url(#kgSoftGlow)"} style={{ transition: "r .3s ease, stroke-width .25s ease, filter .25s ease" }} />
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
          <div className="fade-in pointer-events-none absolute left-3 top-20 z-20 max-w-xs rounded-2xl border border-[rgba(105,126,165,0.14)] bg-white/95 p-4 text-xs shadow-xl backdrop-blur">
            <div className="text-base font-bold text-[#183b8f]">{hover.name}</div>
            <div className="mt-1 text-[11px] font-semibold" style={{ color: kindOf(hover).color }}>{kindOf(hover).label}</div>
            <p className="mt-2 leading-5 text-[#42506b]">{hover.description || "暂无定义"}</p>
            <div className="mt-2 text-[11px] text-[#6f7e97]">拖动节点 · 双击展开 · 点击查看详情</div>
          </div>
        )}
        {legend && (
          <div className="fade-in absolute bottom-9 left-3 z-20 rounded-2xl border border-[rgba(105,126,165,0.14)] bg-white/90 p-4 text-xs shadow-xl backdrop-blur">
            <div className="mb-2 font-bold text-[#183b8f]">图例</div>
            {Object.entries(KIND_META).map(([k, v]) => <div key={k} className="flex items-center gap-2 py-0.5 font-medium text-[#3f4e68]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: v.color, boxShadow: `0 0 0 4px ${v.tint}` }} />{v.label}</div>)}
            <div className="flex items-center gap-2 py-0.5 font-medium text-[#3f4e68]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: DEFAULT_KIND.color, boxShadow: `0 0 0 4px ${DEFAULT_KIND.tint}` }} />{DEFAULT_KIND.label}</div>
            <div className="mt-2 border-t border-[rgba(105,126,165,0.12)] pt-2 text-[#6f7e97]">箭头方向由边标签表示 · 双击展开</div>
          </div>
        )}
      </div>
      <div className="relative z-10 border-t border-[rgba(105,126,165,0.12)] bg-white/70 px-3 py-1.5 text-[10px] text-[#6f7e97] backdrop-blur">完整知识图谱 · 拖动节点/画布 · 滚轮缩放 · 点击选择 · 双击展开</div>
    </div>
  );
}
