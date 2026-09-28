"use client";

import { useEffect, useMemo, useState } from "react";
import {
  reachableNodes,
  WATER_STEPS,
  WASTEWATER_STEPS,
} from "./learning-content";

type Props = {
  network: string;
  name?: string;
  onFocus: (names: string[], network?: string) => void;
  onActivity: (
    title: string,
    detail: string,
    names: string[],
    network?: string,
  ) => void;
};

export default function ConceptLab(p: Props) {
  const initial =
    p.network === "drainage"
      ? "drainage"
      : p.network === "wastewater"
        ? "wastewater"
        : /管网/.test(p.name || "")
          ? "network"
          : "water";
  const [tab, setTab] = useState(initial);
  useEffect(() => {
    setTab(initial);
  }, [initial]);
  return (
    <section className="gx-lab">
      <div className="gx-section-heading">
        <div>
          <span className="gx-eyebrow">动手理解</span>
          <h2>把原理拆开看</h2>
        </div>
        <span className="gx-badge">教学示意</span>
      </div>
      <p className="gx-muted">
        点步骤、切换结构，再观察变化。示意用于理解原理，不表示工程计算结果。
      </p>
      <div className="gx-tabs" role="tablist" aria-label="原理演示类型">
        {[
          ["water", "净水流程"],
          ["network", "供水路径"],
          ["drainage", "排水体制"],
          ["wastewater", "污水处理"],
        ].map(([id, title]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {title}
          </button>
        ))}
      </div>
      {tab === "water" || tab === "wastewater" ? (
        <Process key={tab} type={tab} {...p} />
      ) : tab === "network" ? (
        <NetworkDemo {...p} />
      ) : (
        <DrainageDemo {...p} />
      )}
    </section>
  );
}

function Process(p: Props & { type: string }) {
  const steps = p.type === "water" ? WATER_STEPS : WASTEWATER_STEPS;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hint, setHint] = useState(false);
  const [cycle, setCycle] = useState(0);
  const focus = (index: number) => {
    setStep(index);
    p.onFocus([steps[index].name], p.type);
  };
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (step === steps.length - 1) setPlaying(false);
      else focus(step + 1);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [playing, step]);
  const current = steps[step];
  return (
    <div className="gx-process gx-enter">
      <div className="gx-actions gx-demo-controls">
        <button
          className="gx-primary"
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              if (step === steps.length - 1) focus(0);
              setPlaying(true);
            }
          }}
        >
          {playing ? "暂停演示" : "播放过程"}
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            focus(0);
          }}
        >
          从头开始
        </button>
        <button aria-pressed={hint} onClick={() => setHint(!hint)}>
          提示关键部位
        </button>
      </div>
      <div
        className="gx-flow-steps"
        style={{
          gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
        }}
      >
        {steps.map((s, index) => (
          <button
            key={s.name}
            aria-pressed={step === index}
            className={`${index <= step ? "is-reached" : ""} ${index === step ? "is-current" : ""}`}
            onClick={() => {
              setPlaying(false);
              focus(index);
              setCycle((v) => v + 1);
            }}
          >
            <span className="gx-step-orb">
              {index < step ? "✓" : index + 1}
            </span>
            <strong>{s.name}</strong>
          </button>
        ))}
      </div>
      <div className="gx-process-stage" key={`${step}-${cycle}`}>
        <svg
          viewBox="0 0 640 230"
          role="img"
          aria-label={`${current.name}原理示意`}
        >
          <path d="M30 115 H130 M505 115 H610" className="gx-pipe" />
          <rect
            x="130"
            y="45"
            width="375"
            height="150"
            rx="16"
            className="gx-tank"
          />
          <path
            d="M140 78 Q170 66 200 78 T260 78 T320 78 T380 78 T440 78 T495 78 V183 H140Z"
            className="gx-water"
          />
          {Array.from({ length: 16 }, (_, i) => (
            <circle
              key={i}
              cx={160 + (i % 8) * 42}
              cy={94 + Math.floor(i / 8) * 48}
              r={current.name === "混凝" ? 4 + (i % 4) : 3}
              className={`gx-particle ${current.name === "沉淀" || current.name === "二沉池" ? "settling" : current.name === "消毒" ? "disinfecting" : "moving"}`}
              style={{ animationDelay: `${i * 60}ms` }}
            />
          ))}
          {(current.name === "过滤" || current.name === "格栅") && (
            <g className={hint ? "gx-hint-target" : ""}>
              {Array.from({ length: 7 }, (_, i) => (
                <line
                  key={i}
                  x1={340 + i * 7}
                  x2={340 + i * 7}
                  y1="55"
                  y2="184"
                  className="gx-filter-line"
                />
              ))}
            </g>
          )}
          {(current.name === "沉淀" ||
            current.name === "二沉池" ||
            current.name === "沉砂池") && (
            <path
              d="M145 182 H490"
              className={`gx-sludge ${hint ? "gx-hint-target" : ""}`}
            />
          )}
          {current.name === "混凝" && (
            <g className={hint ? "gx-hint-target" : ""}>
              <path d="M320 25 V105 M290 106 H350" className="gx-mixer" />
              <text x="320" y="20" textAnchor="middle">
                混合与絮凝
              </text>
            </g>
          )}
          {current.name === "消毒" && (
            <g className={hint ? "gx-hint-target" : ""}>
              <path d="M320 25 V75" className="gx-mixer" />
              <text x="320" y="20" textAnchor="middle">
                按工艺控制消毒条件
              </text>
            </g>
          )}
          {current.name === "生物处理" && (
            <g>
              {[0, 1, 2, 3, 4].map((i) => (
                <circle
                  key={i}
                  cx={220 + i * 40}
                  cy="165"
                  r="6"
                  className="gx-bubble"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </g>
          )}
          <text x="65" y="151" textAnchor="middle">
            进水
          </text>
          <text x="560" y="151" textAnchor="middle">
            下一环节
          </text>
        </svg>
      </div>
      <div
        className={`gx-explanation ${hint ? "is-hint" : ""}`}
        aria-live="polite"
      >
        <span className="gx-eyebrow">
          第 {step + 1} 步 / {steps.length}
        </span>
        <h3>
          {current.name}：{current.what}
        </h3>
        <p>{current.note}</p>
        {hint && (
          <p className="gx-hint-text">
            想一想：这一环节改变的是颗粒状态、颗粒去向，还是微生物风险？
          </p>
        )}
      </div>
      <div className="gx-actions gx-demo-controls">
        <button
          disabled={step === 0}
          onClick={() => {
            setPlaying(false);
            focus(step - 1);
          }}
        >
          上一步
        </button>
        <button
          disabled={step === steps.length - 1}
          onClick={() => {
            setPlaying(false);
            focus(step + 1);
          }}
        >
          下一步
        </button>
        <button
          onClick={() =>
            p.onActivity(
              `观察${current.name}`,
              `${current.what}。${current.note}`,
              [current.name],
              p.type,
            )
          }
        >
          记下这个发现
        </button>
      </div>
      <small className="gx-muted">
        {p.type === "water"
          ? "常规地表水净水主线示意；具体工艺随原水水质与处理目标调整。"
          : "典型处理主线简化示意，省略初沉、污泥回流、深度处理等可能存在的环节。"}
      </small>
    </div>
  );
}

function NetworkDemo(p: Props) {
  const [ring, setRing] = useState(true);
  const [disabled, setDisabled] = useState<number | null>(null);
  const vertices: Record<string, [number, number]> = {
    水源: [55, 130],
    A: [190, 130],
    B: [350, 55],
    C: [510, 130],
    D: [350, 210],
  };
  const edges: [string, string][] = ring
    ? [
        ["水源", "A"],
        ["A", "B"],
        ["B", "C"],
        ["C", "D"],
        ["D", "A"],
      ]
    : [
        ["水源", "A"],
        ["A", "B"],
        ["B", "C"],
        ["A", "D"],
      ];
  const reachable = useMemo(
    () => reachableNodes(edges, disabled, "水源"),
    [ring, disabled],
  );
  const affected = Object.keys(vertices).filter((id) => !reachable.has(id));
  const name = ring ? "环状管网" : "枝状管网";
  return (
    <div className="gx-enter">
      <div className="gx-actions gx-demo-controls">
        <button
          aria-pressed={ring}
          onClick={() => {
            setRing(true);
            setDisabled(null);
            p.onFocus(["环状管网"]);
          }}
        >
          环状结构
        </button>
        <button
          aria-pressed={!ring}
          onClick={() => {
            setRing(false);
            setDisabled(null);
            p.onFocus(["枝状管网"]);
          }}
        >
          枝状结构
        </button>
        <button onClick={() => setDisabled(null)}>恢复全部管段</button>
      </div>
      <p className="gx-muted">
        点击一段管线模拟检修，观察哪些节点仍与水源连通。
      </p>
      <svg
        viewBox="0 0 590 280"
        className="gx-network-demo"
        aria-label={`${name}连通性示意`}
      >
        {edges.map(([a, b], index) => (
          <g
            key={`${a}-${b}`}
            className={`${index === disabled ? "is-disabled" : reachable.has(a) && reachable.has(b) ? "is-flowing" : "is-disconnected"}`}
          >
            <path
              className="gx-demo-pipe"
              d={`M${vertices[a].join(",")} L${vertices[b].join(",")}`}
            />
            <path
              role="button"
              tabIndex={0}
              aria-label={`${index === disabled ? "恢复" : "停用"}管段${a}到${b}`}
              className="gx-demo-pipe-hit"
              d={`M${vertices[a].join(",")} L${vertices[b].join(",")}`}
              onClick={() => setDisabled(disabled === index ? null : index)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDisabled(disabled === index ? null : index);
                }
              }}
            />
            {index === disabled && (
              <text
                x={(vertices[a][0] + vertices[b][0]) / 2}
                y={(vertices[a][1] + vertices[b][1]) / 2 - 13}
                textAnchor="middle"
              >
                检修中
              </text>
            )}
          </g>
        ))}
        {Object.entries(vertices).map(([id, [x, y]]) => (
          <g
            key={id}
            transform={`translate(${x},${y})`}
            className={reachable.has(id) ? "gx-connected" : "gx-disconnected"}
          >
            <circle r="23" />
            <text textAnchor="middle" y="5">
              {id}
            </text>
            <text className="gx-demo-caption" textAnchor="middle" y="43">
              {id === "水源"
                ? "供水入口"
                : reachable.has(id)
                  ? "有连通路径"
                  : "无连通路径"}
            </text>
          </g>
        ))}
      </svg>
      <div className="gx-explanation" aria-live="polite">
        <h3>
          {disabled === null
            ? "选择一段管线开始尝试"
            : affected.length
              ? `${affected.join("、")} 暂无连通路径`
              : "其他管段提供了替代路径"}
        </h3>
        <p>
          本图只检查拓扑连通性。有路径不等于水量、水压一定满足要求；真实供水还需水力校核与阀门调度。
        </p>
      </div>
      <button
        onClick={() =>
          p.onActivity(
            `比较${name}的路径`,
            disabled === null
              ? "观察了完整管网结构。"
              : `${edges[disabled].join("—")}停用后，${affected.length ? `${affected.join("、")}失去连通路径。` : "其他管段提供替代路径。"}`,
            [name],
          )
        }
      >
        把观察加入学习路径
      </button>
    </div>
  );
}

function DrainageDemo(p: Props) {
  const [separate, setSeparate] = useState(true),
    [rain, setRain] = useState(false);
  const name = separate ? "分流制" : "合流制";
  return (
    <div className="gx-enter">
      <div className="gx-actions gx-demo-controls">
        <button
          aria-pressed={separate}
          onClick={() => {
            setSeparate(true);
            p.onFocus(["分流制"]);
          }}
        >
          分流制
        </button>
        <button
          aria-pressed={!separate}
          onClick={() => {
            setSeparate(false);
            p.onFocus(["合流制"]);
          }}
        >
          截流式合流制
        </button>
        <button aria-pressed={rain} onClick={() => setRain(!rain)}>
          {rain ? "降雨情境" : "旱天情境"}
        </button>
      </div>
      <svg
        viewBox="0 0 640 300"
        className="gx-drainage-demo"
        aria-label={`${name}${rain ? "降雨" : "旱天"}示意`}
      >
        <text x="50" y="64">
          雨水
        </text>
        <text x="50" y="224">
          污水
        </text>
        <rect x="495" y="190" width="115" height="60" rx="12" />
        <text x="552" y="225" textAnchor="middle">
          污水处理
        </text>
        <rect x="495" y="35" width="115" height="60" rx="12" />
        <text x="552" y="70" textAnchor="middle">
          雨水控制 / 排放
        </text>
        {separate ? (
          <g>
            <path
              className={`gx-water-route ${rain ? "is-running" : ""}`}
              d="M100 60 H490"
            />
            <path className="gx-sewage-route is-running" d="M100 220 H490" />
          </g>
        ) : (
          <g>
            <path
              className={`gx-water-route ${rain ? "is-running" : ""}`}
              d="M100 60 H250 V145"
            />
            <path
              className="gx-sewage-route is-running"
              d="M100 220 H250 V145 H410 V220 H490"
            />
            {rain && (
              <path className="gx-overflow-route" d="M410 145 V65 H490" />
            )}
            <text x="320" y="129" textAnchor="middle">
              合流管
            </text>
            {rain && (
              <text x="435" y="112">
                可能溢流
              </text>
            )}
          </g>
        )}
        {rain &&
          [0, 1, 2, 3].map((i) => (
            <path
              key={i}
              className="gx-raindrop"
              style={{ animationDelay: `${i * 90}ms` }}
              d={`M${120 + i * 30} 12 l-4 10`}
            />
          ))}
      </svg>
      <div className="gx-explanation" aria-live="polite">
        <h3>
          {name} · {rain ? "降雨时" : "旱天"}
        </h3>
        <p>
          {separate
            ? "雨污水通过不同系统输送。雨水仍需结合水质、初期径流和排放要求进行控制，不能简单视为清水。"
            : rain
              ? "降雨使合流系统来水增加；超过截流、调蓄和处理能力时，可能出现溢流。图中虚线表示这种可能性，不是每次降雨都会发生。"
              : "截流式合流系统在旱天通常将污水截流送往污水处理设施。"}
        </p>
      </div>
      <button
        onClick={() =>
          p.onActivity(
            `观察${name}`,
            `${rain ? "降雨" : "旱天"}情境下比较收集输送路径。`,
            [name],
          )
        }
      >
        记下体制差异
      </button>
    </div>
  );
}
