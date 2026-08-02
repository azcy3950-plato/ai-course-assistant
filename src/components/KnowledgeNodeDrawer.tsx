"use client";

import type { KnowledgeGraph, KnowledgeNode, KnowledgeNodeAction } from "@/types";

interface Props {
  node: KnowledgeNode;
  graph: KnowledgeGraph;
  suggestedNextNode?: KnowledgeNode;
  onClose: () => void;
  onNodeClick: (node: KnowledgeNode) => void;
  onAction: (action: KnowledgeNodeAction, node: KnowledgeNode, targetNode?: KnowledgeNode) => void;
}

const resourceLabels = { ppt: "课程PPT", textbook: "教材", case: "案例", reference: "参考资料" } as const;
const categoryLabels = {
  core: "核心概念",
  method: "技术方法",
  goal: "功能目标",
  factor: "影响因素",
  benefit: "效益评估",
} as const;

export default function KnowledgeNodeDrawer({ node, graph, suggestedNextNode, onClose, onNodeClick, onAction }: Props) {
  const byId = new Map(graph.nodes.map((item) => [item.id, item]));
  const prerequisites: KnowledgeNode[] = [];
  const nextNodes: KnowledgeNode[] = [];
  const relatedNodes: KnowledgeNode[] = [];
  graph.edges.forEach((edge) => {
    if (edge.source !== node.id && edge.target !== node.id) return;
    const other = byId.get(edge.source === node.id ? edge.target : edge.source);
    if (!other) return;
    if (["related", "applied_in", "governed_by"].includes(edge.relation)) relatedNodes.push(other);
    else if (edge.target === node.id) prerequisites.push(other);
    else nextNodes.push(other);
  });
  const recommendedNextNode = suggestedNextNode && suggestedNextNode.id !== node.id
    ? byId.get(suggestedNextNode.id) || suggestedNextNode
    : nextNodes[0];

  const progress = node.progress;
  const mastery = progress?.mastery || 0;

  const NodeLinks = ({ title, nodes }: { title: string; nodes: KnowledgeNode[] }) => (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {nodes.length ? nodes.map((item) => (
          <button
            key={item.id}
            onClick={() => onNodeClick(item)}
            className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[10px] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            {item.name}
          </button>
        )) : <span className="text-[10px] text-[var(--color-text-muted)]">暂无</span>}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={onClose}>
      <section
        className="absolute bottom-0 right-0 top-14 flex w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        aria-label={`${node.name}知识点详情`}
      >
        <div className="flex items-start justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] font-medium text-[var(--color-primary)]">
              <span>{node.chapter}</span>
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-white"
                style={{ backgroundColor: node.color || "#64748b" }}
              >
                {categoryLabels[node.category]}
              </span>
            </div>
            <h2 className="text-lg font-bold text-[var(--color-text)]">{node.name}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-gray-100" aria-label="关闭">✕</button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <p className="text-sm leading-6 text-[var(--color-text-secondary)]">{node.description}</p>

          {node.imageUrl && (
            <figure className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-slate-50">
              {/* The source site serves these course images directly from its GitHub Pages project. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={node.imageUrl}
                alt={`${node.name}示意图`}
                loading="lazy"
                className="max-h-56 w-full object-contain"
              />
              <figcaption className="border-t border-[var(--color-border)] px-3 py-2 text-[9px] text-[var(--color-text-muted)]">
                图片来源：海绵城市知识图谱
              </figcaption>
            </figure>
          )}

          {node.sourceUrl && (
            <a
              href={node.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-[10px] text-[var(--color-primary)] hover:underline"
            >
              查看原始知识地图 ↗
            </a>
          )}

          <div className="rounded-xl border border-[var(--color-border)] bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-semibold">当前掌握度</span>
              <span className="font-bold text-[var(--color-primary)]">{mastery}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-[var(--color-primary)] transition-all" style={{ width: `${mastery}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                ["提问", progress?.questionCount || 0],
                ["学习", progress?.studyCount || 0],
                ["测验", progress?.quizTotal || 0],
                ["正确率", `${progress?.quizAccuracy || 0}%`],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-xs font-bold text-[var(--color-text)]">{value}</div>
                  <div className="text-[9px] text-[var(--color-text-muted)]">{label}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[9px] text-[var(--color-text-muted)]">
              最近学习：{progress?.lastStudiedAt ? new Date(progress.lastStudiedAt).toLocaleString("zh-CN") : "尚未学习"}
            </div>
          </div>

          <div className="space-y-3">
            <NodeLinks title="前置知识" nodes={prerequisites} />
            <NodeLinks title="后续知识" nodes={nextNodes} />
            <NodeLinks title="相关知识" nodes={relatedNodes} />
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-[11px] font-semibold text-emerald-700">推荐下一步学习</div>
            {recommendedNextNode ? (
              <button
                onClick={() => onNodeClick(recommendedNextNode)}
                className="mt-2 block w-full rounded-lg bg-white p-3 text-left shadow-sm transition hover:ring-2 hover:ring-emerald-300"
              >
                <div className="text-sm font-semibold text-[var(--color-text)]">{recommendedNextNode.name}</div>
                <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--color-text-secondary)]">
                  {recommendedNextNode.description}
                </div>
              </button>
            ) : (
              <p className="mt-2 text-[10px] text-emerald-700">当前节点暂未配置后续学习节点。</p>
            )}
          </div>

          <div>
            <div className="mb-2 text-[11px] font-semibold text-[var(--color-text-secondary)]">课程资料</div>
            <div className="space-y-2">
              {node.resources.length ? node.resources.map((resource) => (
                <a
                  key={resource.id}
                  href={resource.url || undefined}
                  target={resource.url ? "_blank" : undefined}
                  rel="noreferrer"
                  className="block rounded-lg border border-[var(--color-border)] p-3 hover:border-[var(--color-primary)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--color-text)]">{resource.title}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-[var(--color-text-secondary)]">{resourceLabels[resource.type]}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                    {resource.docName} · {resource.chapter}{resource.page ? ` · 第${resource.page}页` : ""}
                  </div>
                </a>
              )) : <div className="rounded-lg bg-slate-50 p-3 text-[10px] text-[var(--color-text-muted)]">数据库中暂未关联课程资料</div>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-[var(--color-border)] bg-white p-4">
          <button onClick={() => onAction("explain", node)} className="rounded-lg bg-[var(--color-primary)] px-3 py-2.5 text-xs font-medium text-white hover:bg-[var(--color-primary-dark)]">让智能体B讲解</button>
          <button onClick={() => onAction("practice", node)} className="rounded-lg bg-emerald-600 px-3 py-2.5 text-xs font-medium text-white hover:bg-emerald-700">生成练习题</button>
          <button onClick={() => onAction("learn_prerequisite", node)} className="rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]">从前置知识学习</button>
          <button onClick={() => onAction("resources", node)} className="rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]">查看课程资料</button>
          <button
            onClick={() => recommendedNextNode && onAction("learn_next", node, recommendedNextNode)}
            disabled={!recommendedNextNode}
            className="col-span-2 rounded-lg bg-indigo-600 px-3 py-2.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {recommendedNextNode ? `接着学习：${recommendedNextNode.name}` : "暂无下一步推荐"}
          </button>
        </div>
      </section>
    </div>
  );
}
