"use client";

import { useState } from "react";
import { gradePractice, PRACTICES, type Practice } from "./learning-content";
import { moveItem } from "./model";

type Props = {
  onFocus: (names: string[]) => void;
  onResult: (practice: Practice, correct: boolean, assisted: boolean) => void;
};
export default function PracticePanel(p: Props) {
  const [index, setIndex] = useState(0);
  return (
    <section>
      <div className="gx-section-heading">
        <div>
          <span className="gx-eyebrow">学完试一试</span>
          <h2>亲手拼出理解</h2>
        </div>
        <span className="gx-badge">3 种练习</span>
      </div>
      <div className="gx-tabs" role="tablist" aria-label="练习类型">
        {PRACTICES.map((exercise, i) => (
          <button
            role="tab"
            aria-selected={i === index}
            key={exercise.id}
            onClick={() => {
              setIndex(i);
              p.onFocus(exercise.nodeNames);
            }}
          >
            {exercise.type === "order"
              ? "步骤排序"
              : exercise.type === "connect"
                ? "关系连线"
                : "概念分类"}
          </button>
        ))}
      </div>
      <Exercise key={PRACTICES[index].id} exercise={PRACTICES[index]} {...p} />
    </section>
  );
}

function Exercise({ exercise: ex, ...p }: Props & { exercise: Practice }) {
  const initial = () =>
    ex.type === "order" ? [...ex.items] : ex.items.map(() => "");
  const [answer, setAnswer] = useState(initial);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hints, setHints] = useState(0);
  const [result, setResult] = useState<ReturnType<typeof gradePractice> | null>(
    null,
  );
  const [submitted, setSubmitted] = useState(false);
  const edit = (next: string[]) => {
    setAnswer(next);
    setResult(null);
    setSubmitted(false);
  };
  const assign = (index: number, value: string) => {
    const next = [...answer];
    if (ex.type === "connect") {
      const old = next.indexOf(value);
      if (old >= 0 && old !== index) next[old] = "";
    }
    next[index] = value;
    edit(next);
    setSelected(null);
  };
  const hintIndex = answer.findIndex((value, i) => value !== ex.solution[i]);
  const check = () => {
    const grade = gradePractice(ex, answer);
    setResult(grade);
    if (grade.complete) {
      p.onResult(ex, grade.correct, hints > 0);
      setSubmitted(true);
    }
    p.onFocus(
      grade.correct
        ? ex.nodeNames
        : ex.nodeNames.filter((_, i) => grade.wrong.includes(i)),
    );
  };
  return (
    <div className="gx-exercise gx-enter">
      <h3>{ex.title}</h3>
      <p>{ex.prompt}</p>
      {ex.type === "order" && (
        <ol className="gx-order-list">
          {answer.map((item, i) => (
            <li
              key={item}
              draggable
              onDragStart={(e) => {
                setDragIndex(i);
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) edit(moveItem(answer, dragIndex, i));
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              className={`${result?.wrong.includes(i) ? "needs-review" : ""} ${hints > 0 && hintIndex === i ? "gx-hint-target" : ""}`}
            >
              <span className="gx-order-number">{i + 1}</span>
              <strong>{item}</strong>
              <div>
                <button
                  aria-label={`${item}上移`}
                  disabled={i === 0}
                  onClick={() => edit(moveItem(answer, i, i - 1))}
                >
                  ↑
                </button>
                <button
                  aria-label={`${item}下移`}
                  disabled={i === answer.length - 1}
                  onClick={() => edit(moveItem(answer, i, i + 1))}
                >
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {ex.type === "connect" && (
        <div className="gx-connect-exercise">
          <div>
            {ex.items.map((item, i) => (
              <button
                key={item}
                className={`${selected === i ? "is-selected" : ""} ${result?.wrong.includes(i) ? "needs-review" : ""} ${hints > 0 && hintIndex === i ? "gx-hint-target" : ""}`}
                onClick={() => {
                  setSelected(i);
                  p.onFocus([item]);
                }}
              >
                <strong>{item}</strong>
                <small>
                  {answer[i] ? `→ ${answer[i]}` : "选择后，再点右侧作用"}
                </small>
              </button>
            ))}
          </div>
          <div className="gx-connector-column" aria-hidden>
            {ex.items.map((_, i) => (
              <svg key={i} viewBox="0 0 40 80">
                <path
                  className={answer[i] ? "is-connected" : ""}
                  d="M0 40 H40"
                />
              </svg>
            ))}
          </div>
          <div>
            {ex.targets!.map((target) => (
              <button
                key={target}
                disabled={selected === null}
                className={answer.includes(target) ? "is-used" : ""}
                onClick={() => {
                  if (selected !== null) assign(selected, target);
                }}
              >
                {target}
                {answer.includes(target) && <small>已连接 · 可重新分配</small>}
              </button>
            ))}
          </div>
        </div>
      )}
      {ex.type === "classify" && (
        <>
          <div className="gx-classify-items">
            {ex.items.map((item, i) => (
              <div
                key={item}
                draggable
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.setData("text/plain", String(i));
                }}
                onDragEnd={() => setDragIndex(null)}
                className={`gx-classify-card ${result?.wrong.includes(i) ? "needs-review" : ""} ${hints > 0 && hintIndex === i ? "gx-hint-target" : ""}`}
              >
                <strong>{item}</strong>
                <div className="gx-actions">
                  {ex.targets!.map((target) => (
                    <button
                      key={target}
                      aria-pressed={answer[i] === target}
                      onClick={() => assign(i, target)}
                    >
                      {target}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="gx-drop-zones">
            {ex.targets!.map((target) => (
              <div
                key={target}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) assign(dragIndex, target);
                  setDragIndex(null);
                }}
              >
                <strong>{target}</strong>
                {answer.map((v, i) =>
                  v === target ? <span key={i}>{ex.items[i]}</span> : null,
                )}
                <small>拖到这里或点击上方分类</small>
              </div>
            ))}
          </div>
        </>
      )}
      {hints > 0 && (
        <div className="gx-context-hint" role="status">
          <strong>观察高亮的步骤或概念</strong>
          <p>{ex.hints[Math.min(hints - 1, ex.hints.length - 1)]}</p>
        </div>
      )}
      {result && (
        <div
          className={`gx-exercise-feedback gx-enter ${result.correct ? "is-correct" : "is-review"}`}
          aria-live="polite"
        >
          <h3>
            {!result.complete
              ? "还有内容没有完成"
              : result.correct
                ? "关系已经接起来了"
                : "再调整一下高亮的位置"}
          </h3>
          <p>
            {!result.complete
              ? "先完成每一项，再检查你的理解。"
              : result.correct
                ? ex.explanation
                : `有 ${result.wrong.length} 处需要重新考虑。保留已经完成的内容，试着调整后再检查。`}
          </p>
          {result.correct && (
            <small>
              {hints
                ? "借助提示完成 · 下次可以独立再试"
                : "本次独立答对 · 可进入另一种练习"}
            </small>
          )}
        </div>
      )}
      <div className="gx-actions gx-demo-controls">
        <button
          className="gx-primary"
          disabled={submitted && !!result?.correct}
          onClick={check}
        >
          检查我的理解
        </button>
        <button
          onClick={() => {
            setHints((v) => Math.min(v + 1, ex.hints.length));
            p.onFocus(ex.nodeNames);
          }}
        >
          给我一个提示
        </button>
        <button
          onClick={() => {
            setAnswer(initial());
            setHints(0);
            setResult(null);
            setSubmitted(false);
            setSelected(null);
          }}
        >
          重新尝试
        </button>
      </div>
      <small className="gx-muted">
        排序支持拖动和上下按钮；连线与分类都可以直接点击完成。
      </small>
    </div>
  );
}
