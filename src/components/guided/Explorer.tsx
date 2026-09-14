"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "@/types";
import {
  categoryName,
  neighborhood,
  nodeDepth,
  relationExplanation,
  stableLayout,
} from "./model";
import { conceptContent } from "./learning-content";

type Props = {
  graph: KnowledgeGraph;
  selectedId: string | null;
  highlighted: string[];
  visited: string[];
  viewMode: "explore" | "current" | "trail";
  focusRequest: number;
  onSelect: (node: KnowledgeNode) => void;
  onCompare: (id: string) => void;
  onSave: (id: string) => void;
  onCompareDrop: (id: string, slot: number) => void;
};
type View = { x: number; y: number; scale: number };
type Point = { x: number; y: number };
const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

export default function Explorer(p: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const patternId = useId().replace(/:/g, "");
  const positions = useMemo(() => stableLayout(p.graph), [p.graph]);
  const nodes = useMemo(
    () => new Map(p.graph.nodes.map((n) => [n.id, n])),
    [p.graph],
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [edge, setEdge] = useState<KnowledgeEdge | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [manual, setManual] = useState<Record<string, Point>>({});
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{
    id: string | null;
    origin: Point;
    base: Point;
    view: View;
    moved: boolean;
    pinch?: { distance: number; center: Point; view: View };
  } | null>(null);
  const skipClick = useRef(false);
  const parentOf = useMemo(
    () => new Map(p.graph.edges.map((e) => [e.target, e.source])),
    [p.graph],
  );
  const focusSet = useMemo(
    () =>
      neighborhood(
        p.graph,
        p.highlighted.length
          ? p.highlighted
          : p.selectedId
            ? [p.selectedId]
            : [],
        1,
      ),
    [p.graph, p.highlighted, p.selectedId],
  );
  const hoveredSet = useMemo(
    () => neighborhood(p.graph, hover ? [hover] : [], 1),
    [p.graph, hover],
  );
  const hits = useMemo(
    () =>
      query.trim()
        ? p.graph.nodes.filter((n) =>
            `${n.name} ${n.description} ${n.keywords.join(" ")}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          )
        : [],
    [query, p.graph],
  );
  const searchSet = useMemo(
    () =>
      neighborhood(
        p.graph,
        hits.map((n) => n.id),
      ),
    [hits, p.graph],
  );
  const trailSet = useMemo(
    () => neighborhood(p.graph, p.visited),
    [p.graph, p.visited],
  );
  const visible = useMemo(
    () =>
      new Set(
        p.graph.nodes
          .filter((n) => {
            if (query.trim()) return searchSet.has(n.id);
            if (p.viewMode === "current")
              return focusSet.size ? focusSet.has(n.id) : nodeDepth(n) < 2;
            if (p.viewMode === "trail") return trailSet.has(n.id);
            return (
              nodeDepth(n) < 2 ||
              expanded.has(parentOf.get(n.id) || "") ||
              expanded.has("all") ||
              view.scale >= 1.55 ||
              n.id === p.selectedId ||
              p.highlighted.includes(n.id)
            );
          })
          .map((n) => n.id),
      ),
    [
      p.graph,
      query,
      searchSet,
      p.viewMode,
      focusSet,
      trailSet,
      expanded,
      parentOf,
      view.scale,
      p.selectedId,
      p.highlighted,
    ],
  );

  useEffect(() => {
    setExpanded(new Set());
    setManual({});
    setQuery("");
    setEdge(null);
    setHover(null);
    setView({ x: 0, y: 0, scale: 1 });
  }, [p.graph]);

  useEffect(() => {
    if (!p.selectedId) return;
    const point = positions.get(p.selectedId);
    if (!point) return;
    const parent = parentOf.get(p.selectedId);
    if (parent) setExpanded((old) => new Set([...old, parent]));
    const mobileScale =
      typeof window !== "undefined" && window.innerWidth <= 760 ? 1.65 : 1.15;
    const targetScale =
      nodes.get(p.selectedId)?.category === "core" ? 1 : mobileScale;
    setView((v) => {
      const scale = Math.max(targetScale, v.scale);
      return { scale, x: 540 - point.x * scale, y: 350 - point.y * scale };
    });
  }, [p.focusRequest, p.selectedId, positions, parentOf]);

  const localPoint = (clientX: number, clientY: number) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: clientX, y: clientY };
    const pt = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: pt.x, y: pt.y };
  };
  const zoomAt = (factor: number, point: Point = { x: 540, y: 350 }) =>
    setView((v) => {
      const scale = clamp(v.scale * factor, 0.6, 3.6),
        ratio = scale / v.scale;
      return {
        scale,
        x: point.x - (point.x - v.x) * ratio,
        y: point.y - (point.y - v.y) * ratio,
      };
    });
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(
        Math.exp(-event.deltaY * 0.0016),
        localPoint(event.clientX, event.clientY),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const pointFor = (id: string): Point => {
    const base = manual[id] || positions.get(id) || { x: 0, y: 0 };
    if (!dragOffset) return base;
    const isNeighbor = p.graph.edges.some(
      (e) =>
        (e.source === id && e.target === dragOffset.id) ||
        (e.target === id && e.source === dragOffset.id),
    );
    const amount = id === dragOffset.id ? 1 : isNeighbor ? 0.1 : 0;
    return {
      x: base.x + dragOffset.x * amount,
      y: base.y + dragOffset.y * amount,
    };
  };
  const selectNode = (n: KnowledgeNode) => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    setEdge(null);
    if (n.category === "category")
      setExpanded((old) => new Set([...old, n.id]));
    p.onSelect(n);
    setListOpen(false);
  };
  const toggleBranch = () => {
    if (!p.selectedId) return;
    const key =
      nodes.get(p.selectedId)?.category === "category"
        ? p.selectedId
        : parentOf.get(p.selectedId);
    if (!key) return;
    setExpanded((old) => {
      const next = old.has("all")
        ? new Set(
            p.graph.nodes
              .filter((n) => n.category === "category")
              .map((n) => n.id),
          )
        : new Set(old);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setView((v) => ({ ...v, scale: Math.min(v.scale, 1.4) }));
  };
  const hoverNode = hover ? nodes.get(hover) : null;
  const highlightedNodes = p.highlighted.filter((id) => nodes.has(id));

  return (
    <div className="gx-explorer">
      <div className="gx-graph-tools">
        <label className="gx-search">
          <span aria-hidden>⌕</span>
          <input
            aria-label="搜索当前专题知识点"
            placeholder="搜索当前专题…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="清除搜索" onClick={() => setQuery("")}>
              ×
            </button>
          )}
        </label>
        <button
          onClick={() => {
            setExpanded((old) =>
              old.has("all") ? new Set() : new Set(["all"]),
            );
            setView({ x: 0, y: 0, scale: 1 });
          }}
        >
          {expanded.has("all") ? "收起分支" : "展开全部"}
        </button>
        <button
          onClick={() => {
            setManual({});
            setView({ x: 0, y: 0, scale: 1 });
          }}
          title="恢复全图与节点位置"
        >
          归位
        </button>
        <button aria-pressed={listOpen} onClick={() => setListOpen(!listOpen)}>
          目录
        </button>
      </div>
      {query && (
        <div className="gx-search-results" aria-label="搜索结果">
          {hits.length ? (
            hits.slice(0, 10).map((n) => (
              <button key={n.id} onClick={() => selectNode(n)}>
                {n.name} <span>定位 ↗</span>
              </button>
            ))
          ) : (
            <span>没有匹配的知识点，试试其他词。</span>
          )}
        </div>
      )}
      {listOpen && (
        <div
          className="gx-node-directory gx-enter"
          aria-label="当前专题知识目录"
        >
          {p.graph.nodes.map((n) => (
            <button
              key={n.id}
              className={`depth-${nodeDepth(n)}`}
              onClick={() => selectNode(n)}
            >
              <span>{n.name}</span>
              <small>{categoryName(n)}</small>
            </button>
          ))}
        </div>
      )}
      <div className="gx-map-area">
        <svg
          ref={svg}
          viewBox="0 0 1080 700"
          aria-label="交互式知识图谱"
          className={`gx-map ${dragging ? "is-dragging" : ""}`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "+" || e.key === "=") zoomAt(1.2);
            if (e.key === "-") zoomAt(1 / 1.2);
            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              setView((v) => ({
                ...v,
                x:
                  v.x +
                  (e.key === "ArrowLeft"
                    ? 40
                    : e.key === "ArrowRight"
                      ? -40
                      : 0),
                y:
                  v.y +
                  (e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0),
              }));
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0 && e.pointerType === "mouse") return;
            const point = localPoint(e.clientX, e.clientY);
            pointers.current.set(e.pointerId, point);
            const captureTarget =
              (e.target as Element).closest("[data-node]") || e.target;
            if (captureTarget instanceof Element)
              captureTarget.setPointerCapture(e.pointerId);
            if (pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              gesture.current = {
                id: null,
                origin: point,
                base: point,
                view: viewRef.current,
                moved: true,
                pinch: {
                  distance: Math.hypot(a.x - b.x, a.y - b.y),
                  center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                  view: viewRef.current,
                },
              };
              setDragOffset(null);
              setDragging(true);
              skipClick.current = true;
              return;
            }
            const id =
              (e.target as Element)
                .closest("[data-node]")
                ?.getAttribute("data-node") || null;
            gesture.current = {
              id,
              origin: point,
              base: id ? pointFor(id) : point,
              view: viewRef.current,
              moved: false,
            };
            skipClick.current = false;
          }}
          onPointerMove={(e) => {
            const g = gesture.current;
            if (!g || !pointers.current.has(e.pointerId)) return;
            const point = localPoint(e.clientX, e.clientY);
            pointers.current.set(e.pointerId, point);
            if (g.pinch && pointers.current.size >= 2) {
              const [a, b] = [...pointers.current.values()],
                center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              const scale = clamp(
                (g.pinch.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) /
                  Math.max(1, g.pinch.distance),
                0.6,
                3.6,
              );
              const k = scale / g.pinch.view.scale;
              setView({
                scale,
                x: center.x - (g.pinch.center.x - g.pinch.view.x) * k,
                y: center.y - (g.pinch.center.y - g.pinch.view.y) * k,
              });
              return;
            }
            if (g.pinch) return;
            const dx = point.x - g.origin.x,
              dy = point.y - g.origin.y;
            if (Math.hypot(dx, dy) < 5 && !g.moved) return;
            g.moved = true;
            skipClick.current = true;
            setDragging(true);
            setHover(null);
            if (g.id)
              setDragOffset({
                id: g.id,
                x: dx / g.view.scale,
                y: dy / g.view.scale,
              });
            else setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
          }}
          onPointerUp={(e) => {
            const g = gesture.current;
            const drop = document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest("[data-concept-drop]");
            if (g?.id && g.moved && drop) {
              if (drop.getAttribute("data-concept-drop") === "save")
                p.onSave(g.id);
              else
                p.onCompareDrop(
                  g.id,
                  Number(drop.getAttribute("data-slot") || 0),
                );
              pointers.current.clear();
              gesture.current = null;
              setDragging(false);
              setDragOffset(null);
              return;
            }
            if (g?.id && g.moved && !g.pinch) {
              const point = localPoint(e.clientX, e.clientY),
                id = g.id;
              setManual((old) => ({
                ...old,
                [id]: {
                  x: g.base.x + (point.x - g.origin.x) / g.view.scale,
                  y: g.base.y + (point.y - g.origin.y) / g.view.scale,
                },
              }));
            }
            pointers.current.delete(e.pointerId);
            if (!pointers.current.size) {
              gesture.current = null;
              setDragging(false);
              setDragOffset(null);
            }
          }}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId);
            gesture.current = null;
            setDragOffset(null);
            setDragging(false);
          }}
        >
          <defs>
            <pattern
              id={patternId}
              width="28"
              height="28"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="1" fill="currentColor" opacity=".1" />
            </pattern>
          </defs>
          <rect
            width="1080"
            height="700"
            fill={`url(#${patternId})`}
            pointerEvents="none"
          />
          <g
            className="gx-camera"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          >
            {p.graph.edges.map((e, i) => {
              const a = pointFor(e.source),
                b = pointFor(e.target),
                shown = visible.has(e.source) && visible.has(e.target);
              const active = hover
                ? hoveredSet.has(e.source) && hoveredSet.has(e.target)
                : focusSet.has(e.source) && focusSet.has(e.target);
              return (
                <g
                  key={e.id}
                  className={`gx-edge ${shown ? "is-visible" : ""} ${active ? "is-active" : ""}`}
                  style={{ transitionDelay: `${Math.min(i, 8) * 12}ms` }}
                  aria-hidden={!shown}
                >
                  <path
                    className="gx-edge-line"
                    pathLength={1}
                    d={`M${a.x},${a.y} Q${(a.x + b.x) / 2 + 12},${(a.y + b.y) / 2 - 12} ${b.x},${b.y}`}
                  />
                  <path
                    role="button"
                    tabIndex={shown ? 0 : -1}
                    aria-label={`查看关系：${nodes.get(e.source)?.name}与${nodes.get(e.target)?.name}`}
                    className="gx-edge-hit"
                    d={`M${a.x},${a.y} Q${(a.x + b.x) / 2 + 12},${(a.y + b.y) / 2 - 12} ${b.x},${b.y}`}
                    onClick={() => {
                      if (!skipClick.current) setEdge(e);
                      skipClick.current = false;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setEdge(e);
                      }
                    }}
                  />
                  {(active || view.scale > 1.65) && shown && (
                    <text
                      className="gx-edge-label"
                      x={(a.x + b.x) / 2 + 7}
                      y={(a.y + b.y) / 2 - 10}
                    >
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
            {p.graph.nodes.map((n, i) => {
              const point = pointFor(n.id),
                parent = pointFor(parentOf.get(n.id) || n.id),
                shown = visible.has(n.id),
                depth = nodeDepth(n);
              const selected = n.id === p.selectedId,
                lit = highlightedNodes.includes(n.id),
                dim = hover
                  ? !hoveredSet.has(n.id)
                  : p.viewMode === "current" &&
                    highlightedNodes.length > 0 &&
                    !focusSet.has(n.id);
              const radius = depth === 0 ? 36 : depth === 1 ? 26 : 17;
              return (
                <g
                  key={n.id}
                  data-node={n.id}
                  data-visible={shown}
                  data-testid={`node-${n.name}`}
                  role="button"
                  tabIndex={shown ? 0 : -1}
                  aria-label={`${n.name}，${categoryName(n)}，点击查看`}
                  aria-hidden={!shown}
                  className={`gx-node ${shown ? "is-visible" : ""} ${selected ? "is-selected" : ""} ${lit ? "is-lit" : ""} ${dim ? "is-dim" : ""} gx-depth-${depth}`}
                  style={{
                    transform: `translate(${shown ? point.x : parent.x}px, ${shown ? point.y : parent.y}px) scale(${shown ? 1 : 0.15})`,
                    transitionDelay: dragging
                      ? "0ms"
                      : `${Math.min(i % 6, 5) * 24}ms`,
                  }}
                  onClick={() => selectNode(n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectNode(n);
                    }
                  }}
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse" && !dragging) setHover(n.id);
                  }}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(n.id)}
                  onBlur={() => setHover(null)}
                >
                  <circle r={radius + 8} fill="transparent" />
                  <circle className="gx-node-halo" r={radius + 10} />
                  <circle className="gx-node-disc" r={radius} />
                  {p.visited.includes(n.id) && (
                    <circle
                      className="gx-visited-dot"
                      cx={radius * 0.78}
                      cy={-radius * 0.78}
                      r="4.5"
                    />
                  )}
                  <text
                    className="gx-node-label"
                    textAnchor="middle"
                    y={radius + 20}
                  >
                    {n.name.length > 10 ? (
                      <>
                        <tspan x="0">{n.name.slice(0, 10)}</tspan>
                        <tspan x="0" dy="16">
                          {n.name.slice(10)}
                        </tspan>
                      </>
                    ) : (
                      n.name
                    )}
                  </text>
                  {view.scale >= 2 && (
                    <text
                      className="gx-node-meta"
                      textAnchor="middle"
                      y={radius + (n.name.length > 10 ? 53 : 37)}
                    >
                      {categoryName(n)} ·{" "}
                      {p.visited.includes(n.id) ? "已浏览" : "待探索"}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        {hoverNode && !edge && (
          <div className="gx-hover-preview">
            <span className="gx-eyebrow">{categoryName(hoverNode)}</span>
            <strong>{hoverNode.name}</strong>
            <p>{conceptContent(hoverNode).definition}</p>
            <small>点击查看 · 拖动调整位置</small>
          </div>
        )}
        {edge && nodes.has(edge.source) && nodes.has(edge.target) && (
          <div
            className="gx-relation gx-enter"
            role="region"
            aria-label="知识关系说明"
          >
            <button
              className="gx-close"
              onClick={() => setEdge(null)}
              aria-label="关闭关系说明"
            >
              ×
            </button>
            <span className="gx-eyebrow">读懂这条关系</span>
            <h3>
              {nodes.get(edge.source)!.name} <span>—</span>{" "}
              {nodes.get(edge.target)!.name}
            </h3>
            <p>
              {relationExplanation(
                edge,
                nodes.get(edge.source)!,
                nodes.get(edge.target)!,
              )}
            </p>
            <div className="gx-actions">
              <button
                onClick={() => {
                  p.onCompare(edge.source);
                  p.onCompare(edge.target);
                  setEdge(null);
                }}
              >
                放在一起比较
              </button>
              <button
                onClick={() => {
                  p.onSelect(nodes.get(edge.target)!);
                  setEdge(null);
                }}
              >
                查看知识点
              </button>
            </div>
          </div>
        )}
        {p.viewMode === "trail" && !trailSet.size && (
          <div className="gx-map-empty">
            点击一个知识点开始探索，学习足迹会出现在这里。
            <button
              onClick={() => {
                const root = p.graph.nodes.find((n) => n.category === "core");
                if (root) p.onSelect(root);
              }}
            >
              从本专题开始
            </button>
          </div>
        )}
        <div className="gx-zoom">
          <button aria-label="放大图谱" onClick={() => zoomAt(1.25)}>
            ＋
          </button>
          <span>{Math.round(view.scale * 100)}%</span>
          <button aria-label="缩小图谱" onClick={() => zoomAt(0.8)}>
            −
          </button>
        </div>
        <div className="gx-map-caption">
          <span className="gx-status-dot" />
          {view.scale >= 2
            ? "细节层 · 分类与学习状态"
            : view.scale >= 1.55 || expanded.has("all")
              ? "概念层 · 知识点已展开"
              : "专题层 · 点击章节展开"}
        </div>
      </div>
      <div className="gx-graph-footer">
        <span>{visible.size} 个可见节点 · 拖动探索 / 双指缩放</span>
        {p.selectedId && nodes.get(p.selectedId)?.category !== "core" && (
          <button onClick={toggleBranch}>展开 / 收起本分支</button>
        )}
      </div>
    </div>
  );
}
