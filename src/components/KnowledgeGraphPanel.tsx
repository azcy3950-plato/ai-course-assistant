"use client";

import { useMemo } from "react";
import type {
  GraphContext,
  KnowledgeEdge,
  KnowledgeGraph,
  KnowledgeNode,
  KnowledgeNodeCategory,
} from "@/types";

interface Props {
  graph: KnowledgeGraph;
  graphContext?: GraphContext;
  selectedNodeId?: string;
  depth: 1 | 2;
  onDepthChange: (depth: 1 | 2) => void;
  onNodeClick: (node: KnowledgeNode) => void;
}

const categoryLegend: Array<{
  category: KnowledgeNodeCategory;
  label: string;
  color: string;
}> = [
  { category: "core", label: "核心概念", color: "#00d4ff" },
  { category: "method", label: "技术方法", color: "#7c3aed" },
  { category: "goal", label: "功能目标", color: "#10b981" },
  { category: "factor", label: "影响因素", color: "#f97316" },
  { category: "benefit", label: "效益评估", color: "#ec4899" },
];

const categoryLabels = Object.fromEntries(
  categoryLegend.map((item) => [item.category, item.label]),
) as Record<KnowledgeNodeCategory, string>;

const categoryColors = Object.fromEntries(
  categoryLegend.map((item) => [item.category, item.color]),
) as Record<KnowledgeNodeCategory, string>;

const roleStyles = {
  focus: { stroke: "#2563eb", width: 4, dash: undefined },
  prerequisite: { stroke: "#f59e0b", width: 3, dash: "5 3" },
  next: { stroke: "#10b981", width: 3, dash: undefined },
  related: { stroke: "#8b5cf6", width: 3, dash: "3 3" },
  neutral: { stroke: "transparent", width: 0, dash: undefined },
} as const;

function labelLines(label: string, maxChars: number) {
  if (label.length <= maxChars) return [label];
  const second = label.slice(maxChars, maxChars * 2);
  return [label.slice(0, maxChars), `${second}${label.length > maxChars * 2 ? "…" : ""}`];
}

export default function KnowledgeGraphPanel({
  graph,
  graphContext,
  selectedNodeId,
  depth,
  onDepthChange,
  onNodeClick,
}: Props) {
  const focusId = selectedNodeId || graphContext?.focusNode.id || graph.nodes[0]?.id;
  const rootId = graph.nodes.find((node) => node.id === "km-01")?.id || graph.nodes[0]?.id;
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const focusNode = focusId ? nodeById.get(focusId) : undefined;

  const neighborhood = useMemo(() => {
    const upstreamIds = new Set<string>();
    const downstreamIds = new Set<string>();
    if (!focusId) return { upstreamIds, downstreamIds };
    graph.edges.forEach((edge) => {
      if (edge.target === focusId) upstreamIds.add(edge.source);
      if (edge.source === focusId) downstreamIds.add(edge.target);
    });
    return { upstreamIds, downstreamIds };
  }, [focusId, graph.edges]);

  const fullLevels = useMemo(() => {
    const levels = new Map<string, number>();
    if (!rootId) return levels;
    levels.set(rootId, 0);
    let frontier = [rootId];
    for (let level = 1; level <= 3 && frontier.length; level += 1) {
      const next: string[] = [];
      for (const sourceId of frontier) {
        graph.edges.forEach((edge) => {
          if (edge.source !== sourceId || levels.has(edge.target)) return;
          levels.set(edge.target, level);
          next.push(edge.target);
        });
      }
      frontier = next;
    }
    graph.nodes.forEach((node) => {
      if (!levels.has(node.id)) levels.set(node.id, 3);
    });
    return levels;
  }, [graph.edges, graph.nodes, rootId]);

  const visible = useMemo(() => {
    if (!focusId) return { nodes: [] as KnowledgeNode[], edges: [] as KnowledgeEdge[] };
    if (depth === 2) return { nodes: graph.nodes, edges: graph.edges };

    const visibleIds = new Set<string>([focusId]);
    graph.edges.forEach((edge) => {
      if (edge.source === focusId || edge.target === focusId) {
        visibleIds.add(edge.source);
        visibleIds.add(edge.target);
      }
    });
    const nodes = [...visibleIds]
      .map((id) => nodeById.get(id))
      .filter((node): node is KnowledgeNode => Boolean(node));
    const edges = graph.edges.filter(
      (edge) => edge.source === focusId || edge.target === focusId,
    );
    return { nodes, edges };
  }, [depth, focusId, graph.edges, graph.nodes, nodeById]);

  const positions = useMemo(() => {
    const result = new Map<string, { x: number; y: number }>();
    if (!focusId) return result;

    if (depth === 2) {
      const center = { x: 350, y: 350 };
      const ringRadii = [0, 120, 225, 310];
      result.set(rootId || focusId, center);
      for (let level = 1; level <= 3; level += 1) {
        const ringNodes = visible.nodes.filter((node) => fullLevels.get(node.id) === level);
        ringNodes.forEach((node, index) => {
          const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(1, ringNodes.length);
          result.set(node.id, {
            x: center.x + Math.cos(angle) * ringRadii[level],
            y: center.y + Math.sin(angle) * ringRadii[level],
          });
        });
      }
      return result;
    }

    result.set(focusId, { x: 350, y: 280 });
    const upstream = visible.nodes.filter((node) => neighborhood.upstreamIds.has(node.id));
    const downstream = visible.nodes.filter((node) => neighborhood.downstreamIds.has(node.id));
    upstream.forEach((node, index) => {
      result.set(node.id, { x: ((index + 1) * 660) / (upstream.length + 1) + 20, y: 105 });
    });
    downstream.forEach((node, index) => {
      result.set(node.id, { x: ((index + 1) * 660) / (downstream.length + 1) + 20, y: 455 });
    });
    return result;
  }, [depth, focusId, fullLevels, neighborhood.downstreamIds, neighborhood.upstreamIds, rootId, visible.nodes]);

  const stateFor = (nodeId: string): keyof typeof roleStyles => {
    if (focusId === nodeId) return "focus";
    const edge = graph.edges.find(
      (item) =>
        (item.source === focusId && item.target === nodeId) ||
        (item.target === focusId && item.source === nodeId),
    );
    if (edge && ["related", "applied_in", "governed_by"].includes(edge.relation)) return "related";
    if (neighborhood.upstreamIds.has(nodeId)) return "prerequisite";
    if (neighborhood.downstreamIds.has(nodeId)) return "next";
    return "neutral";
  };

  const radiusFor = (nodeId: string) => {
    if (depth === 1) return nodeId === focusId ? 31 : 27;
    const level = fullLevels.get(nodeId) || 0;
    if (level === 0) return 34;
    if (level === 1) return 28;
    if (level === 2) return 21;
    return 25;
  };

  if (!graph.nodes.length) {
    return <div className="p-8 text-center text-xs text-[var(--color-text-muted)]">知识图谱暂无可用节点</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div>
          <div className="text-xs font-semibold text-[var(--color-text)]">
            {focusNode ? `当前：${focusNode.name}` : "海绵城市知识结构"}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--color-text-muted)]">
            <span>{graph.nodes.length} 个节点 · {graph.edges.length} 条关系</span>
            <span>{depth === 2 ? "完整图谱 · 含技术方法层" : "当前节点邻近关系"}</span>
            {graph.source && (
              <a
                href={graph.source.url}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-primary)] hover:underline"
              >
                来源：{graph.source.title} ↗
              </a>
            )}
          </div>
        </div>
        <button
          onClick={() => onDepthChange(depth === 1 ? 2 : 1)}
          className="shrink-0 rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-[10px] text-[var(--color-primary)] hover:bg-[var(--color-primary-bg)]"
        >
          {depth === 1 ? "展开完整图谱" : "收起为邻近图"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-gradient-to-b from-slate-50 to-white">
        <svg
          viewBox={depth === 2 ? "0 0 700 700" : "0 0 700 560"}
          className="h-full min-h-[380px] w-full"
          aria-label="海绵城市知识图谱"
        >
          <defs>
            <marker id="kg-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L7,3 z" fill="#94a3b8" />
            </marker>
            <filter id="kg-shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.15" />
            </filter>
          </defs>

          {depth === 1 && (
            <g aria-hidden="true" fill="#64748b" fontSize="11" fontWeight="700">
              <text x="20" y="30">上行关系（前置 / 来源）</text>
              <text x="20" y="265">当前知识节点</text>
              <text x="20" y="545">下行关系（后续 / 应用）</text>
              {neighborhood.upstreamIds.size === 0 && (
                <text x="350" y="105" textAnchor="middle" fill="#94a3b8" fontWeight="400">暂无已配置的上游节点</text>
              )}
              {neighborhood.downstreamIds.size === 0 && (
                <text x="350" y="455" textAnchor="middle" fill="#94a3b8" fontWeight="400">暂无已配置的下游节点</text>
              )}
            </g>
          )}

          {visible.edges.map((edge) => {
            const from = positions.get(edge.source);
            const to = positions.get(edge.target);
            if (!from || !to) return null;
            const highlighted = depth === 1
              ? edge.source === focusId || edge.target === focusId
              : graphContext?.highlightEdges.includes(edge.id);
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const length = Math.sqrt(dx * dx + dy * dy) || 1;
            const sourceRadius = radiusFor(edge.source) + 3;
            const targetRadius = radiusFor(edge.target) + 6;
            const start = {
              x: from.x + (dx / length) * sourceRadius,
              y: from.y + (dy / length) * sourceRadius,
            };
            const end = {
              x: to.x - (dx / length) * targetRadius,
              y: to.y - (dy / length) * targetRadius,
            };
            return (
              <g key={edge.id}>
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={highlighted ? "#2563eb" : "#cbd5e1"}
                  strokeWidth={highlighted ? 2.8 : depth === 2 ? 1.2 : 1.5}
                  strokeDasharray={edge.relation === "related" ? "5 4" : undefined}
                  markerEnd="url(#kg-arrow)"
                />
                {highlighted && (
                  <text
                    x={(from.x + to.x) / 2}
                    y={(from.y + to.y) / 2 - 4}
                    textAnchor="middle"
                    fontSize={depth === 2 ? 7 : 8}
                    fill="#475569"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {visible.nodes.map((node) => {
            const point = positions.get(node.id);
            if (!point) return null;
            const state = stateFor(node.id);
            const role = roleStyles[state];
            const selected = selectedNodeId === node.id;
            const radius = radiusFor(node.id);
            const fill = node.color || categoryColors[node.category];
            const textColor = node.category === "core" ? "#083344" : "#ffffff";
            const maxChars = radius <= 21 ? 4 : radius <= 28 ? 5 : 6;
            const lines = labelLines(node.name, maxChars);
            const fontSize = radius <= 21 ? 9 : radius <= 28 ? 11 : 12;
            return (
              <g
                key={node.id}
                transform={`translate(${point.x} ${point.y})`}
                role="button"
                tabIndex={0}
                className="cursor-pointer outline-none"
                onClick={() => onNodeClick(node)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onNodeClick(node);
                }}
              >
                <title>{`${node.name}｜${categoryLabels[node.category]}｜点击查看详情`}</title>
                {state !== "neutral" && (
                  <circle
                    r={radius + 7}
                    fill="none"
                    stroke={role.stroke}
                    strokeWidth={role.width}
                    strokeDasharray={role.dash}
                    opacity="0.9"
                  />
                )}
                {selected && (
                  <circle
                    r={radius + 11}
                    fill="none"
                    stroke="#0f172a"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                )}
                <circle
                  r={radius}
                  fill={fill}
                  stroke={fill}
                  strokeWidth="2"
                  filter="url(#kg-shadow)"
                />
                <text
                  textAnchor="middle"
                  fontSize={fontSize}
                  fontWeight="700"
                  fill={textColor}
                >
                  {lines.map((line, index) => (
                    <tspan
                      key={`${line}-${index}`}
                      x="0"
                      y={lines.length === 1 ? 3 : index === 0 ? -2 : 8}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
                {node.progress && radius >= 20 && (
                  <g transform={`translate(${radius - 7} ${-radius + 5})`}>
                    <circle r="9" fill="#ffffff" stroke={role.stroke === "transparent" ? fill : role.stroke} />
                    <text textAnchor="middle" dominantBaseline="middle" fontSize="6.5" fontWeight="700" fill="#475569">
                      {node.progress.mastery}%
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="border-t border-[var(--color-border)] px-3 py-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-[var(--color-text-secondary)]">
          {categoryLegend.map((item) => (
            <span key={item.category}>
              <i
                className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </span>
          ))}
        </div>
        <div className="mt-1 text-[9px] text-[var(--color-text-muted)]">
          外圈高亮：蓝色当前 · 橙色前置 · 绿色后续 · 紫色相关
        </div>
        {graphContext?.suggestedNextNode && (
          <button
            onClick={() => onNodeClick(graphContext.suggestedNextNode!)}
            className="mt-2 w-full rounded-md bg-[var(--color-primary-bg)] px-2 py-1.5 text-left text-[10px] text-[var(--color-primary)] hover:bg-blue-100"
          >
            推荐下一知识点：<strong>{graphContext.suggestedNextNode.name}</strong>
          </button>
        )}
      </div>
    </div>
  );
}
