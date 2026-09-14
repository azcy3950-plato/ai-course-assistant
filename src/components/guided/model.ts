import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "@/types";

export type NetworkInfo = {
  id: string;
  chip: string;
  title: string;
  summary: string;
  source?: string;
  sections: { label: string; full: string; target: string | null }[];
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  nodeIds: string[];
  kind: "answer" | "hint" | "final" | "info" | "question";
  pending?: boolean;
  error?: boolean;
  retry?: {
    question: string;
    mode: "guide" | "example" | "explain" | "reply" | "hint";
  };
};
export type Thought = {
  id: string;
  text: string;
  feedback: string;
  nodeIds: string[];
  status: "thinking" | "revisit" | "summarized";
};
export type SavedConcept = {
  nodeId: string;
  note: string;
  x: number;
  y: number;
};
export type TrailStep = {
  id: string;
  nodeId: string;
  title: string;
  detail: string;
  kind: "explore" | "answer" | "practice" | "summary";
};
export type WorkspaceSession = {
  messages: Message[];
  thoughts: Thought[];
  saved: SavedConcept[];
  trail: TrailStep[];
  visited: string[];
  activeNetwork: string;
  selectedId: string | null;
  topic: string;
  turn: number;
  active: boolean;
  hints: number;
  notes: string;
  links: [string, string][];
  practiceResults: Record<string, { correct: boolean; assisted: boolean }>;
};
export const emptySession = (): WorkspaceSession => ({
  messages: [],
  thoughts: [],
  saved: [],
  trail: [],
  visited: [],
  activeNetwork: "overview",
  selectedId: null,
  topic: "",
  turn: 0,
  active: false,
  hints: 0,
  notes: "",
  links: [],
  practiceResults: {},
});
export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const networkOf = (id: string) => id.split(":")[0];
export const nodeDepth = (node: KnowledgeNode) =>
  node.category === "core" ? 0 : node.category === "category" ? 1 : 2;
export const categoryName = (node: KnowledgeNode) =>
  ({
    core: "专题",
    category: "章节",
    concept: "概念",
    method: "方法",
    standard: "指标与规范",
    case: "案例",
    detail: "知识点",
    goal: "目标",
    factor: "因素",
    benefit: "应用",
  })[node.category] || "知识点";

export function neighborhood(
  graph: KnowledgeGraph,
  ids: string[],
  depth = 1,
): Set<string> {
  const all = new Set(graph.nodes.map((n) => n.id));
  const result = new Set(ids.filter((id) => all.has(id)));
  let frontier = new Set(result);
  for (let i = 0; i < depth; i++) {
    const next = new Set<string>();
    graph.edges.forEach((e) => {
      if (frontier.has(e.source) && !result.has(e.target)) next.add(e.target);
      if (frontier.has(e.target) && !result.has(e.source)) next.add(e.source);
    });
    next.forEach((id) => result.add(id));
    frontier = next;
  }
  return result;
}

/** Selection and expansion preserve the full network's stable coordinates. */
export function stableLayout(graph: KnowledgeGraph) {
  const root = graph.nodes.find((n) => n.category === "core");
  const sections = graph.nodes.filter((n) => n.category === "category");
  const positions = new Map<string, { x: number; y: number }>();
  if (root) positions.set(root.id, { x: 540, y: 350 });
  sections.forEach((n, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(sections.length, 1);
    positions.set(n.id, {
      x: 540 + Math.cos(a) * 245,
      y: 350 + Math.sin(a) * 218,
    });
    const children = graph.edges
      .filter((e) => e.source === n.id)
      .map((e) => graph.nodes.find((m) => m.id === e.target))
      .filter((m): m is KnowledgeNode => !!m);
    children.forEach((child, j) => {
      const spread = Math.min(
        0.74,
        ((Math.PI * 2) / Math.max(sections.length, 1)) * 0.8,
      );
      const angle =
        a +
        ((j - (children.length - 1) / 2) * spread) /
          Math.max(children.length - 1, 1);
      positions.set(child.id, {
        x: 540 + Math.cos(angle) * 420,
        y: 350 + Math.sin(angle) * 315,
      });
    });
  });
  graph.nodes.forEach((n, i) => {
    if (!positions.has(n.id))
      positions.set(n.id, {
        x: 100 + (i % 7) * 140,
        y: 70 + Math.floor(i / 7) * 100,
      });
  });
  return positions;
}

export function relationExplanation(
  edge: KnowledgeEdge,
  source: KnowledgeNode,
  target: KnowledgeNode,
) {
  if (edge.label === "章节")
    return `“${target.name}”是“${source.name}”下的一个章节。这条线表示课程内容的归属，不代表先后顺序或因果。`;
  if (edge.label === "知识点")
    return `“${target.name}”归入“${source.name}”这一章节。可以从章节主题出发，理解这个知识点在其中的作用。`;
  return {
    prerequisite: `学习“${target.name}”前，先理解“${source.name}”。`,
    leads_to: `这条关系从“${source.name}”指向“${target.name}”，表示图谱标注的推导或后续联系。`,
    related: `“${source.name}”与“${target.name}”相关；相关不一定代表因果。`,
    applied_in: `“${source.name}”应用于“${target.name}”。`,
    governed_by: `“${source.name}”需要参考“${target.name}”的约束。`,
  }[edge.relation];
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length)
    return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function restoreSession(
  value: unknown,
  validIds: Set<string>,
): WorkspaceSession {
  const base = emptySession();
  if (!value || typeof value !== "object") return base;
  const v = value as Partial<WorkspaceSession>;
  const ids = (x: unknown) =>
    Array.isArray(x)
      ? x.filter(
          (id): id is string => typeof id === "string" && validIds.has(id),
        )
      : [];
  const s = (x: unknown, max = 20000) =>
    typeof x === "string" ? x.slice(0, max) : "";
  base.messages = Array.isArray(v.messages)
    ? v.messages
        .filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            !m.pending,
        )
        .slice(-100)
        .map((m) => ({
          id: s(m.id) || uid(),
          role: m.role,
          content: s(m.content),
          nodeIds: ids(m.nodeIds),
          kind: ["answer", "hint", "final", "info", "question"].includes(m.kind)
            ? m.kind
            : "answer",
          error: !!m.error,
        }))
    : [];
  base.thoughts = Array.isArray(v.thoughts)
    ? v.thoughts
        .filter((t) => t && typeof t.text === "string")
        .slice(-40)
        .map((t) => ({
          id: s(t.id) || uid(),
          text: s(t.text),
          feedback: s(t.feedback),
          nodeIds: ids(t.nodeIds),
          status: ["thinking", "revisit", "summarized"].includes(t.status)
            ? t.status
            : "thinking",
        }))
    : [];
  base.saved = Array.isArray(v.saved)
    ? v.saved
        .filter((t) => t && validIds.has(t.nodeId))
        .slice(0, 24)
        .map((t, i) => ({
          nodeId: t.nodeId,
          note: s(t.note, 2000),
          x: Number.isFinite(t.x)
            ? Math.max(0, Math.min(580, t.x))
            : (i % 3) * 220,
          y: Number.isFinite(t.y)
            ? Math.max(0, Math.min(1000, t.y))
            : Math.floor(i / 3) * 150,
        }))
    : [];
  base.trail = Array.isArray(v.trail)
    ? v.trail
        .filter((t) => t && validIds.has(t.nodeId))
        .slice(-80)
        .map((t) => ({
          id: s(t.id) || uid(),
          nodeId: t.nodeId,
          title: s(t.title, 200),
          detail: s(t.detail, 4000),
          kind: ["explore", "answer", "practice", "summary"].includes(t.kind)
            ? t.kind
            : "explore",
        }))
    : [];
  base.visited = ids(v.visited);
  base.selectedId =
    v.selectedId && validIds.has(v.selectedId) ? v.selectedId : null;
  base.activeNetwork = [
    "overview",
    "general",
    "water",
    "drainage",
    "wastewater",
    "sponge",
    "power",
    "resilience",
  ].includes(v.activeNetwork || "")
    ? v.activeNetwork!
    : "overview";
  base.topic = s(v.topic, 2000);
  base.active = !!v.active && !!base.topic;
  base.turn = Math.min(3, Math.max(0, Number(v.turn) || 0));
  base.hints = Math.min(4, Math.max(0, Number(v.hints) || 0));
  base.notes = s(v.notes, 10000);
  base.links = Array.isArray(v.links)
    ? v.links
        .filter(
          (l) =>
            Array.isArray(l) &&
            l.length === 2 &&
            validIds.has(l[0]) &&
            validIds.has(l[1]) &&
            l[0] !== l[1],
        )
        .slice(0, 50)
    : [];
  if (v.practiceResults && typeof v.practiceResults === "object")
    Object.entries(v.practiceResults)
      .slice(0, 100)
      .forEach(([key, result]) => {
        if (result && typeof result.correct === "boolean")
          base.practiceResults[key] = {
            correct: result.correct,
            assisted: !!result.assisted,
          };
      });
  return base;
}
