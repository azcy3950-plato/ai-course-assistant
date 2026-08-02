"use client";

import { useEffect, useRef, useMemo } from "react";
import { Network } from "vis-network/standalone";
import type {
  GraphContext,
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

const categoryColors: Record<KnowledgeNodeCategory, string> = {
  core: "#00d4ff",
  method: "#7c3aed",
  goal: "#10b981",
  factor: "#f97316",
  benefit: "#ec4899",
};

const categoryLabels: Record<KnowledgeNodeCategory, string> = {
  core: "核心概念",
  method: "技术方法",
  goal: "功能目标",
  factor: "影响因素",
  benefit: "效益评估",
};

export default function KnowledgeGraphPanel({
  graph,
  graphContext,
  selectedNodeId,
  depth,
  onDepthChange,
  onNodeClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesMap = useRef<Map<string, KnowledgeNode>>(new Map());

  // Build node map
  useEffect(() => {
    nodesMap.current.clear();
    graph.nodes.forEach((n) => nodesMap.current.set(n.id, n));
  }, [graph.nodes]);

  // Determine focus node
  const focusId = selectedNodeId || graphContext?.focusNode.id || graph.nodes[0]?.id;

  // Build neighborhood for depth=1
  const neighborhood = useMemo(() => {
    const upstreamIds = new Set<string>();
    const downstreamIds = new Set<string>();
    if (depth === 1 && focusId) {
      graph.edges.forEach((e) => {
        if (e.target === focusId) upstreamIds.add(e.source);
        if (e.source === focusId) downstreamIds.add(e.target);
      });
    }
    return { upstreamIds, downstreamIds };
  }, [depth, focusId, graph.edges]);

  // Compute visible nodes and edges
  const visible = useMemo(() => {
    if (depth === 2) return { nodes: graph.nodes, edges: graph.edges };
    if (!focusId) return { nodes: [], edges: [] };
    const focusNode = graph.nodes.find((n) => n.id === focusId);
    if (!focusNode) return { nodes: [], edges: [] };
    const nodeSet = new Set<string>([focusId]);
    neighborhood.upstreamIds.forEach((id) => nodeSet.add(id));
    neighborhood.downstreamIds.forEach((id) => nodeSet.add(id));
    return {
      nodes: graph.nodes.filter((n) => nodeSet.has(n.id)),
      edges: graph.edges.filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target)),
    };
  }, [depth, focusId, graph, neighborhood]);

  // Build vis-network data
  const visData = useMemo(() => {
    const visNodes = visible.nodes.map((node) => {
      const isFocus = node.id === focusId;
      const color = node.color || categoryColors[node.category] || "#00d4ff";
      return {
        id: node.id,
        label: node.name,
        title: `${node.name}\n${categoryLabels[node.category] || ""}\n${node.description?.slice(0, 100) || ""}`,
        color: {
          background: color,
          border: isFocus ? "#ffffff" : "rgba(255,255,255,0.3)",
          highlight: { background: color, border: "#ffffff" },
        },
        borderWidth: isFocus ? 3 : 1,
        size: isFocus ? 45 : 32,
        font: {
          color: isFocus ? "#ffffff" : "#cccccc",
          size: isFocus ? 16 : 13,
          face: "Microsoft YaHei, sans-serif",
          strokeWidth: 2,
          strokeColor: "rgba(0,0,0,0.5)",
        },
        shape: "dot",
        shadow: isFocus ? { enabled: true, color: color, size: 15, x: 0, y: 0 } : false,
      };
    });

    const visEdges = visible.edges.map((edge) => {
      const isHighlighted = depth === 1 || graphContext?.highlightEdges.includes(edge.id);
      return {
        id: edge.id,
        from: edge.source,
        to: edge.target,
        label: edge.label || "",
        arrows: "to",
        color: {
          color: isHighlighted ? "#6366f1" : "#334155",
          highlight: "#818cf8",
        },
        width: isHighlighted ? 2 : 1,
        smooth: { type: "curvedCW", roundness: 0.2 },
        font: { color: "#888888", size: 10, strokeWidth: 1, strokeColor: "rgba(0,0,0,0.8)" },
      };
    });

    return { nodes: visNodes, edges: visEdges };
  }, [visible, focusId, depth, graphContext]);

  // Initialize network
  useEffect(() => {
    if (!containerRef.current) return;
    if (networkRef.current) {
      networkRef.current.setData(visData);
      return;
    }

    const options = {
      physics: {
        enabled: true,
        solver: "forceAtlas2Based",
        forceAtlas2Based: {
          gravitationalConstant: -50,
          centralGravity: 0.01,
          springLength: 200,
          springConstant: 0.08,
          damping: 0.4,
        },
        stabilization: { iterations: 100 },
      },
      interaction: {
        dragNodes: true,
        dragView: true,
        zoomView: true,
        hover: true,
        tooltipDelay: 200,
      },
      nodes: {
        borderWidth: 2,
        borderWidthSelected: 4,
        color: { border: "rgba(255,255,255,0.3)" },
      },
      edges: {
        arrows: { to: { scaleFactor: 0.8 } },
        smooth: { type: "curvedCW", roundness: 0.2 },
      },
    };

    const network = new Network(containerRef.current, visData, options);
    networkRef.current = network;

    network.on("click", (params: any) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0];
        const node = nodesMap.current.get(nodeId);
        if (node) onNodeClick(node);
      }
    });

    network.on("stabilizationIterationsDone", () => {
      network.setOptions({ physics: { enabled: false } });
    });

    return () => {
      network.destroy();
      networkRef.current = null;
    };
  }, []);

  // Update data when it changes
  useEffect(() => {
    if (networkRef.current) {
      networkRef.current.setData(visData);
      // Briefly enable physics for smooth transition
      networkRef.current.setOptions({ physics: { enabled: true } });
      setTimeout(() => {
        if (networkRef.current) {
          networkRef.current.setOptions({ physics: { enabled: false } });
        }
      }, 2000);
    }
  }, [visData]);

  // Focus on selected node
  useEffect(() => {
    if (networkRef.current && selectedNodeId) {
      networkRef.current.focus(selectedNodeId, {
        scale: 1.2,
        animation: { duration: 500, easingFunction: "easeInOutQuad" },
      });
    }
  }, [selectedNodeId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 shrink-0" style={{ background: "rgba(10,14,39,0.95)" }}>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {focusId ? `当前：${graph.nodes.find((n) => n.id === focusId)?.name || focusId}` : "海绵城市知识结构"}
          </span>
        </div>
        <button
          onClick={() => onDepthChange(depth === 1 ? 2 : 1)}
          className="shrink-0 rounded-md border border-gray-700 px-2 py-1 text-[10px] text-indigo-400 hover:bg-indigo-900/30"
        >
          {depth === 1 ? "展开完整图谱" : "收起为邻近图"}
        </button>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0"
        style={{ background: "linear-gradient(135deg, #0a0e27 0%, #1a1040 50%, #0d1b2a 100%)" }}
      />
      <div className="flex gap-3 px-3 py-1.5 shrink-0 flex-wrap" style={{ background: "rgba(10,14,39,0.95)" }}>
        {Object.entries(categoryLabels).map(([cat, label]) => (
          <span key={cat} className="flex items-center gap-1 text-[10px] text-gray-400">
            <span className="w-2 h-2 rounded-full" style={{ background: categoryColors[cat as KnowledgeNodeCategory] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
