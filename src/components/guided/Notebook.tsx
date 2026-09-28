"use client";

import { useRef, useState } from "react";
import type { KnowledgeNode } from "@/types";
import {
  moveItem,
  type SavedConcept,
  type Thought,
  type TrailStep,
} from "./model";

type Props = {
  nodes: Map<string, KnowledgeNode>;
  saved: SavedConcept[];
  links: [string, string][];
  thoughts: Thought[];
  notes: string;
  onSaved: (items: SavedConcept[]) => void;
  onLinks: (links: [string, string][]) => void;
  onNotes: (text: string) => void;
  onFocus: (ids: string[]) => void;
  onRevisit: (text: string) => void;
};
export default function Notebook(p: Props) {
  const [tab, setTab] = useState<"thoughts" | "cards">("thoughts");
  const [linkStart, setLinkStart] = useState<string | null>(null);
  const [boardMode, setBoardMode] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const [moving, setMoving] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const safeLinks = p.links.filter(
    ([a, b]) =>
      p.saved.some((c) => c.nodeId === a) &&
      p.saved.some((c) => c.nodeId === b),
  );
  const position = (c: SavedConcept) => (moving?.id === c.nodeId ? moving : c);
  const connect = (id: string) => {
    if (!linkStart) {
      setLinkStart(id);
      return;
    }
    if (
      linkStart !== id &&
      !safeLinks.some(
        ([a, b]) =>
          (a === linkStart && b === id) || (a === id && b === linkStart),
      )
    )
      p.onLinks([...safeLinks, [linkStart, id]]);
    setLinkStart(null);
  };
  const updateNote = (id: string, note: string) =>
    p.onSaved(p.saved.map((c) => (c.nodeId === id ? { ...c, note } : c)));
  const remove = (id: string) => {
    p.onSaved(p.saved.filter((c) => c.nodeId !== id));
    p.onLinks(safeLinks.filter((l) => !l.includes(id)));
    if (linkStart === id) setLinkStart(null);
  };
  return (
    <section>
      <div className="gx-section-heading">
        <div>
          <span className="gx-eyebrow">留下自己的理解</span>
          <h2>我的知识整理区</h2>
        </div>
        <span className="gx-badge">自动保存在本浏览器</span>
      </div>
      <div className="gx-tabs" role="tablist" aria-label="知识整理方式">
        <button
          role="tab"
          aria-selected={tab === "thoughts"}
          onClick={() => setTab("thoughts")}
        >
          我的思路 · {p.thoughts.length}
        </button>
        <button
          role="tab"
          aria-selected={tab === "cards"}
          onClick={() => setTab("cards")}
        >
          概念卡片 · {p.saved.length}
        </button>
      </div>
      {tab === "thoughts" ? (
        <div className="gx-thoughts">
          {p.thoughts.length ? (
            p.thoughts.map((t, i) => (
              <article key={t.id} className={`gx-thought gx-enter ${t.status}`}>
                <span className="gx-thought-number">{i + 1}</span>
                <div>
                  <span className="gx-eyebrow">
                    {t.status === "thinking"
                      ? "正在形成的想法"
                      : t.status === "revisit"
                        ? "继续补充"
                        : "本轮已总结"}
                  </span>
                  <p className="gx-my-thought">{t.text}</p>
                  {t.feedback && (
                    <details>
                      <summary>查看这一轮反馈</summary>
                      <p>{t.feedback}</p>
                    </details>
                  )}
                  <div className="gx-actions">
                    <button onClick={() => p.onFocus(t.nodeIds)}>
                      在图谱上定位
                    </button>
                    <button
                      onClick={() =>
                        p.onRevisit(`我想重新理解这个想法：${t.text}`)
                      }
                    >
                      重新想一想
                    </button>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="gx-soft-empty">
              <strong>你的第一张思路卡会从一次回答开始。</strong>
              <p>在引导学习中写下想法，每一轮回答和反馈都会保留在这里。</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="gx-actions gx-demo-controls">
            <button
              aria-pressed={!boardMode}
              onClick={() => setBoardMode(false)}
            >
              列表整理
            </button>
            <button aria-pressed={boardMode} onClick={() => setBoardMode(true)}>
              我的小图
            </button>
            {linkStart && (
              <button onClick={() => setLinkStart(null)}>取消连接</button>
            )}
          </div>
          <p className="gx-muted">
            {linkStart
              ? `已选择“${p.nodes.get(linkStart)?.name}”，再点另一张卡片的“连接”。`
              : "从图谱收集概念，写下自己的理解；点击两张卡片的“连接”建立个人关联。"}
          </p>
          {p.saved.length ? (
            <div className={boardMode ? "gx-board-scroll" : ""}>
              <div
                ref={board}
                className={boardMode ? "gx-note-board" : "gx-note-list"}
                style={
                  boardMode
                    ? {
                        height: Math.max(440, ...p.saved.map((c) => c.y + 195)),
                      }
                    : undefined
                }
              >
                {boardMode && (
                  <svg
                    className="gx-board-lines"
                    width="800"
                    height="100%"
                    aria-label="个人概念关联"
                  >
                    {safeLinks.map(([a, b]) => {
                      const ca = p.saved.find((c) => c.nodeId === a)!,
                        cb = p.saved.find((c) => c.nodeId === b)!;
                      const pa = position(ca),
                        pb = position(cb);
                      return (
                        <line
                          key={`${a}-${b}`}
                          x1={pa.x + 100}
                          y1={pa.y + 70}
                          x2={pb.x + 100}
                          y2={pb.y + 70}
                        />
                      );
                    })}
                  </svg>
                )}
                {p.saved.map((c, i) => {
                  const node = p.nodes.get(c.nodeId);
                  if (!node) return null;
                  const pos = position(c);
                  return (
                    <article
                      key={c.nodeId}
                      className={`gx-note-card gx-enter ${linkStart === c.nodeId ? "is-selected" : ""}`}
                      style={
                        boardMode
                          ? {
                              transform: `translate(${pos.x}px, ${pos.y}px)`,
                              transition: moving ? "none" : undefined,
                            }
                          : undefined
                      }
                    >
                      <header
                        onPointerDown={(e) => {
                          if (
                            !boardMode ||
                            (e.target as Element).closest("button")
                          )
                            return;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          drag.current = {
                            id: c.nodeId,
                            x: e.clientX,
                            y: e.clientY,
                            baseX: c.x,
                            baseY: c.y,
                          };
                        }}
                        onPointerMove={(e) => {
                          const d = drag.current;
                          if (!d || d.id !== c.nodeId) return;
                          setMoving({
                            id: c.nodeId,
                            x: Math.max(
                              0,
                              Math.min(580, d.baseX + e.clientX - d.x),
                            ),
                            y: Math.max(
                              0,
                              Math.min(1000, d.baseY + e.clientY - d.y),
                            ),
                          });
                        }}
                        onPointerUp={() => {
                          if (moving?.id === c.nodeId)
                            p.onSaved(
                              p.saved.map((card) =>
                                card.nodeId === c.nodeId
                                  ? { ...card, x: moving.x, y: moving.y }
                                  : card,
                              ),
                            );
                          drag.current = null;
                          setMoving(null);
                        }}
                        onPointerCancel={() => {
                          drag.current = null;
                          setMoving(null);
                        }}
                      >
                        <strong>{node.name}</strong>
                        <button
                          onClick={() => remove(c.nodeId)}
                          aria-label={`移除${node.name}`}
                        >
                          ×
                        </button>
                      </header>
                      <textarea
                        aria-label={`${node.name}的个人笔记`}
                        value={c.note}
                        placeholder="我理解的是……"
                        maxLength={2000}
                        onChange={(e) => updateNote(c.nodeId, e.target.value)}
                      />
                      <div className="gx-actions">
                        <button onClick={() => p.onFocus([c.nodeId])}>
                          定位
                        </button>
                        <button
                          aria-pressed={linkStart === c.nodeId}
                          onClick={() => connect(c.nodeId)}
                        >
                          连接
                        </button>
                        {!boardMode && (
                          <>
                            <button
                              aria-label={`${node.name}前移`}
                              disabled={!i}
                              onClick={() =>
                                p.onSaved(moveItem(p.saved, i, i - 1))
                              }
                            >
                              ↑
                            </button>
                            <button
                              aria-label={`${node.name}后移`}
                              disabled={i === p.saved.length - 1}
                              onClick={() =>
                                p.onSaved(moveItem(p.saved, i, i + 1))
                              }
                            >
                              ↓
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="gx-soft-empty">
              <strong>先收集一个感兴趣的概念。</strong>
              <p>选择图谱节点后，点击“收进整理区”。</p>
            </div>
          )}
          {safeLinks.length > 0 && (
            <div className="gx-personal-links">
              <span className="gx-eyebrow">
                我建立的关联 · 可调整，不代表课程标准关系
              </span>
              {safeLinks.map(([a, b]) => (
                <div key={`${a}-${b}`}>
                  <span>
                    {p.nodes.get(a)?.name} ↔ {p.nodes.get(b)?.name}
                  </span>
                  <button
                    onClick={() =>
                      p.onLinks(
                        safeLinks.filter((l) => !(l[0] === a && l[1] === b)),
                      )
                    }
                    aria-label={`移除${p.nodes.get(a)?.name}与${p.nodes.get(b)?.name}的关联`}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <label className="gx-reflection">
        <strong>这一轮，我最重要的发现</strong>
        <textarea
          value={p.notes}
          maxLength={10000}
          onChange={(e) => p.onNotes(e.target.value)}
          placeholder="试着用自己的话概括，也可以写下还没想清楚的问题。"
        />
      </label>
    </section>
  );
}

export function Replay({
  trail,
  current,
  playing,
  onPlay,
  onPause,
  onStep,
  onStop,
  onExport,
}: {
  trail: TrailStep[];
  current: number;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStep: (index: number) => void;
  onStop: () => void;
  onExport: () => void;
}) {
  const step = trail[current];
  return (
    <section>
      <div className="gx-section-heading">
        <div>
          <span className="gx-eyebrow">从问题到理解</span>
          <h2>这一轮的学习路径</h2>
        </div>
        <button onClick={onExport} disabled={!trail.length}>
          保存学习小结
        </button>
      </div>
      <p className="gx-muted">
        回放会依次定位到你探索、回答和练习过的知识点。随时暂停，点击任意一步重新查看。
      </p>
      {trail.length > 0 ? (
        <>
          <div className="gx-actions gx-demo-controls">
            <button className="gx-primary" onClick={playing ? onPause : onPlay}>
              {playing ? "暂停回放" : "播放学习路径"}
            </button>
            <button
              onClick={() => onStep(Math.max(0, current - 1))}
              disabled={current <= 0}
            >
              上一步
            </button>
            <button
              onClick={() => onStep(Math.min(trail.length - 1, current + 1))}
              disabled={current >= trail.length - 1}
            >
              下一步
            </button>
            <button onClick={onStop}>结束回放</button>
          </div>
          <div className="gx-replay-progress">
            <span
              style={{
                width: `${((Math.max(0, current) + 1) / trail.length) * 100}%`,
              }}
            />
          </div>
          {step && (
            <div
              key={step.id}
              className="gx-replay-stage gx-enter"
              aria-live="polite"
            >
              <span className="gx-eyebrow">
                {current + 1} / {trail.length}
              </span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </div>
          )}
          <ol className="gx-trail-list">
            {trail.map((t, i) => (
              <li key={t.id}>
                <button
                  className={current === i ? "is-current" : ""}
                  aria-current={current === i ? "step" : undefined}
                  onClick={() => onStep(i)}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <strong>{t.title}</strong>
                  <small>
                    {
                      {
                        explore: "探索",
                        answer: "思考",
                        practice: "练习",
                        summary: "发现",
                      }[t.kind]
                    }
                  </small>
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="gx-soft-empty">
          <strong>学习路径会随着你的操作逐步形成。</strong>
          <p>先选择一个知识点，或开始一轮引导学习。</p>
        </div>
      )}
    </section>
  );
}
