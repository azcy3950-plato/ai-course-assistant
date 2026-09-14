"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { GraphContext, KnowledgeGraph, KnowledgeNode } from "@/types";
import { getAuthToken, useApp } from "@/contexts/AppContext";
import Explorer from "./Explorer";
import ConceptLab from "./ConceptLab";
import PracticePanel from "./PracticePanel";
import Notebook, { Replay } from "./Notebook";
import { conceptContent, type Practice } from "./learning-content";
import {
  categoryName,
  emptySession,
  networkOf,
  restoreSession,
  uid,
  type Message,
  type NetworkInfo,
  type WorkspaceSession,
} from "./model";

type Panel = "learn" | "lab" | "practice" | "notes" | "replay";
type ResponseData = {
  greeting?: string;
  response?: string;
  answer?: string;
  hint?: string;
  status?: string;
  graphContext?: GraphContext;
  error?: string;
};
const PANELS: [Panel, string][] = [
  ["learn", "引导学习"],
  ["lab", "原理演示"],
  ["practice", "动手练习"],
  ["notes", "知识整理"],
  ["replay", "学习回放"],
];
const SUGGESTIONS: Record<string, string[]> = {
  overview: [
    "怎样理解城市基础设施的系统性？",
    "常规净水处理各环节有什么作用？",
    "分流制和合流制怎么选择？",
  ],
  general: ["城市基础设施有哪些共同特性？", "为什么基础设施规划需要分期建设？"],
  water: ["混凝、沉淀、过滤、消毒有什么区别？", "环状管网和枝状管网如何选择？"],
  drainage: ["分流制和合流制怎么选择？", "地形条件怎样影响重力排水？"],
  wastewater: [
    "一级处理与二级处理分别解决什么问题？",
    "污泥为什么还需要单独处理？",
  ],
  sponge: ["雨水花园如何处理雨水径流？", "透水铺装有哪些适用条件？"],
  power: [
    "电力负荷预测如何影响供电设施布局？",
    "供电可靠性与电网结构有什么关系？",
  ],
  resilience: [
    "韧性城市怎样应对基础设施中断？",
    "自然解决方案适合哪些城市问题？",
  ],
};

export default function GuidedWorkspace() {
  const { state } = useApp();
  const [allGraph, setAllGraph] = useState<KnowledgeGraph>({
    nodes: [],
    edges: [],
  });
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [session, setSession] = useState<WorkspaceSession>(emptySession);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [ready, setReady] = useState(false),
    [loadError, setLoadError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0),
    [storageError, setStorageError] = useState(false);
  const storageKey = useRef("");
  const [panel, setPanel] = useState<Panel>("learn");
  const [mobile, setMobile] = useState<"graph" | "work">("graph");
  const [viewMode, setViewMode] = useState<"explore" | "current" | "trail">(
    "explore",
  );
  const [focusRequest, setFocusRequest] = useState(0),
    [highlighted, setHighlighted] = useState<string[]>([]);
  const [detailOpen, setDetailOpen] = useState(false),
    [compared, setCompared] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false),
    [compareAspect, setCompareAspect] = useState("definition");
  const [input, setInput] = useState(""),
    [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(""),
    [confirmNew, setConfirmNew] = useState(false);
  const [pendingTopic, setPendingTopic] = useState<{
    question: string;
    mode: "guide" | "example" | "explain";
  } | null>(null);
  const [replayIndex, setReplayIndex] = useState(-1),
    [playing, setPlaying] = useState(false);
  const [explainWalk, setExplainWalk] = useState<{
    messageId: string;
    ids: string[];
    index: number;
    playing: boolean;
  } | null>(null);
  const [ratio, setRatio] = useState(50),
    [resizing, setResizing] = useState(false);
  const [graphHelp, setGraphHelp] = useState(false);
  const container = useRef<HTMLDivElement>(null),
    chatScroll = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true),
    abort = useRef<AbortController | null>(null),
    sequence = useRef(0);
  const nodes = useMemo(
    () => new Map(allGraph.nodes.map((n) => [n.id, n])),
    [allGraph],
  );
  const graph = useMemo(() => {
    const selected = allGraph.nodes.filter(
        (n) => networkOf(n.id) === session.activeNetwork,
      ),
      ids = new Set(selected.map((n) => n.id));
    return {
      nodes: selected,
      edges: allGraph.edges.filter(
        (e) => ids.has(e.source) && ids.has(e.target),
      ),
    };
  }, [allGraph, session.activeNetwork]);
  const currentNetwork = networks.find((n) => n.id === session.activeNetwork);
  const selected = session.selectedId
    ? nodes.get(session.selectedId)
    : undefined;
  const patch = (change: Partial<WorkspaceSession>) =>
    setSession((old) => ({ ...old, ...change }));
  const showToast = useCallback((text: string) => setToast(text), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (state.authLoading || !state.role) return;
    const controller = new AbortController();
    setReady(false);
    setLoadError("");
    (async () => {
      try {
        const res = await fetch("/api/knowledge-graph?network=all", {
          headers: { Authorization: `Bearer ${getAuthToken()}` },
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok || !data.graph?.nodes?.length)
          throw new Error(data.error || "知识图谱暂时没有加载成功");
        if (controller.signal.aborted) return;
        setAllGraph(data.graph);
        setNetworks(data.networks || []);
        let account = "";
        try {
          const user = JSON.parse(
            localStorage.getItem("aicourse-user") || "{}",
          );
          account = String(user.email || user.id || "");
        } catch {
          /* skip storage when account cannot be determined */
        }
        storageKey.current = account
          ? `guided-studio-v2:${encodeURIComponent(account)}`
          : "";
        let restored = emptySession();
        if (storageKey.current) {
          try {
            const raw = localStorage.getItem(storageKey.current);
            if (raw)
              restored = restoreSession(
                JSON.parse(raw),
                new Set<string>(
                  data.graph.nodes.map((n: KnowledgeNode) => n.id),
                ),
              );
          } catch {
            setStorageError(true);
          }
        }
        setSession(restored);
        setHighlighted(restored.selectedId ? [restored.selectedId] : []);
        setReady(true);
      } catch (error) {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error ? error.message : "加载失败，请重试",
          );
      }
    })();
    return () => controller.abort();
  }, [state.authLoading, state.role, loadVersion]);
  useEffect(() => {
    if (!ready || !storageKey.current) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          storageKey.current,
          JSON.stringify({
            ...session,
            messages: session.messages.filter((m) => !m.pending).slice(-100),
            thoughts: session.thoughts.slice(-40),
            trail: session.trail.slice(-80),
          }),
        );
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [ready, session]);
  useEffect(
    () => () => {
      abort.current?.abort();
      sequence.current++;
    },
    [],
  );
  useEffect(() => {
    if (!compareOpen && !pendingTopic && !confirmNew) return;
    const prior = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(
      ".gx-root [role=dialog]",
    );
    const list = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ) || [],
      );
    list()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCompareOpen(false);
        setPendingTopic(null);
        setConfirmNew(false);
      }
      if (e.key === "Tab") {
        const items = list(),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      if (prior?.isConnected) prior.focus();
    };
  }, [compareOpen, pendingTopic, confirmNew]);
  useEffect(() => {
    const el = chatScroll.current;
    if (el && followBottom.current) el.scrollTop = el.scrollHeight;
  }, [session.messages, panel]);

  const choose = useCallback(
    (node: KnowledgeNode, record = true, open = true) => {
      setPlaying(false);
      setExplainWalk(null);
      setHighlighted([node.id]);
      setFocusRequest((v) => v + 1);
      setDetailOpen(open);
      setSession((old) => ({
        ...old,
        activeNetwork: networkOf(node.id),
        selectedId: node.id,
        visited: old.visited.includes(node.id)
          ? old.visited
          : [...old.visited, node.id],
        trail:
          record && old.trail.at(-1)?.nodeId !== node.id
            ? [
                ...old.trail,
                {
                  id: uid(),
                  nodeId: node.id,
                  title: `探索${node.name}`,
                  detail: conceptContent(node).definition,
                  kind: "explore" as const,
                },
              ].slice(-80)
            : old.trail,
      }));
    },
    [],
  );
  const switchNetwork = (id: string) => {
    const root = allGraph.nodes.find(
      (n) => networkOf(n.id) === id && n.category === "core",
    );
    setDetailOpen(false);
    setViewMode("explore");
    setPlaying(false);
    if (root) choose(root, false, false);
    else patch({ activeNetwork: id, selectedId: null });
  };
  const selectGraphNode = (node: KnowledgeNode) => {
    if (session.activeNetwork === "overview") {
      const target = currentNetwork?.sections.find(
        (s) => s.label === node.name || s.full === node.name,
      )?.target;
      if (target) {
        switchNetwork(target);
        return;
      }
    }
    choose(node);
  };
  const focusIds = useCallback(
    (ids: string[], changePanel = false) => {
      const valid = ids.filter((id) => nodes.has(id));
      if (!valid.length) return;
      const node = nodes.get(valid[0])!;
      setSession((old) => ({
        ...old,
        activeNetwork: networkOf(node.id),
        selectedId: node.id,
      }));
      setHighlighted(valid);
      setFocusRequest((v) => v + 1);
      setDetailOpen(false);
      setViewMode("current");
      if (changePanel) setMobile("graph");
    },
    [nodes],
  );
  const focusNames = (names: string[], network?: string) => {
    const ids = names
      .map(
        (name) =>
          allGraph.nodes.find(
            (n) =>
              n.name === name &&
              networkOf(n.id) === (network || sessionRef.current.activeNetwork),
          ) || allGraph.nodes.find((n) => n.name === name),
      )
      .filter((n): n is KnowledgeNode => !!n)
      .map((n) => n.id);
    focusIds(ids);
  };
  const addCompare = (id: string) => {
    setCompared((old) => (old.includes(id) ? old : [...old, id].slice(-2)));
    setCompareOpen(true);
  };
  const dropCompare = (id: string, slot: number) => {
    setCompared((old) => {
      const next = [...old];
      if (next[1 - slot] === id) next[1 - slot] = "";
      next[slot] = id;
      return next;
    });
    showToast(`“${nodes.get(id)?.name}”已放入比较位 ${slot + 1}`);
  };
  const saveConcept = (id: string) => {
    if (session.saved.some((c) => c.nodeId === id)) {
      showToast("这个概念已经在整理区里了");
      return;
    }
    if (session.saved.length >= 24) {
      showToast("整理区已收集 24 个概念，可以先整理或移除一些卡片");
      return;
    }
    setSession((old) => ({
      ...old,
      saved: [
        ...old.saved,
        {
          nodeId: id,
          note: "",
          x: (old.saved.length % 3) * 240 + 20,
          y: Math.floor(old.saved.length / 3) * 185 + 20,
        },
      ],
    }));
    showToast(`“${nodes.get(id)?.name}”已收入知识整理区`);
  };
  const activity = (
    title: string,
    detail: string,
    names: string[],
    network?: string,
  ) => {
    const node =
      names
        .map(
          (name) =>
            allGraph.nodes.find(
              (n) =>
                n.name === name &&
                networkOf(n.id) === (network || session.activeNetwork),
            ) || allGraph.nodes.find((n) => n.name === name),
        )
        .find(Boolean) || selected;
    if (!node) return;
    setSession((old) => ({
      ...old,
      trail: [
        ...old.trail,
        { id: uid(), nodeId: node.id, title, detail, kind: "summary" as const },
      ].slice(-80),
      visited: [...new Set([...old.visited, node.id])],
    }));
    showToast("发现已加入学习路径");
  };
  const practiceResult = (
    ex: Practice,
    correct: boolean,
    assisted: boolean,
  ) => {
    const node = allGraph.nodes.find((n) => n.name === ex.nodeNames[0]);
    setSession((old) => ({
      ...old,
      practiceResults: {
        ...old.practiceResults,
        [ex.id]: { correct, assisted },
      },
      trail: node
        ? [
            ...old.trail,
            {
              id: uid(),
              nodeId: node.id,
              title: ex.title,
              detail: correct
                ? `${assisted ? "借助提示完成" : "独立答对"}。${ex.explanation}`
                : "已经尝试，需要继续调整高亮位置。",
              kind: "practice" as const,
            },
          ].slice(-80)
        : old.trail,
    }));
  };

  const applyContext = (context?: GraphContext): string[] => {
    if (!context)
      return sessionRef.current.selectedId
        ? [sessionRef.current.selectedId]
        : [];
    const ids = [
      context.focusNode?.id,
      ...(context.highlightNodeIds || []),
    ].filter((id): id is string => !!id && nodes.has(id));
    if (ids.length) focusIds([...new Set(ids)]);
    return [...new Set(ids)];
  };
  useEffect(() => {
    if (!explainWalk?.playing) return;
    focusIds([explainWalk.ids[explainWalk.index]]);
    const timer = window.setTimeout(
      () =>
        setExplainWalk((old) =>
          !old
            ? null
            : old.index >= old.ids.length - 1
              ? { ...old, playing: false }
              : { ...old, index: old.index + 1 },
        ),
      1800,
    );
    return () => window.clearTimeout(timer);
  }, [explainWalk, focusIds]);
  const runRequest = async (
    question: string,
    mode: "guide" | "example" | "explain" | "reply" | "hint",
  ) => {
    if (loading || !question.trim()) return;
    if (abort.current) return;
    const before = sessionRef.current,
      controller = new AbortController();
    abort.current = controller;
    const seq = ++sequence.current,
      id = uid();
    setLoading(true);
    setPanel("learn");
    setMobile("work");
    setDetailOpen(false);
    setPlaying(false);
    setExplainWalk(null);
    followBottom.current = true;
    const starting =
      mode === "guide" || mode === "example" || mode === "explain";
    const userText = mode === "hint" ? "" : question.trim();
    const isReply = mode === "reply";
    const baseIds = before.selectedId ? [before.selectedId] : [];
    const pending: Message = {
      id,
      role: "assistant",
      content:
        mode === "hint"
          ? "正在为当前问题准备提示…"
          : "正在结合课程内容组织回应…",
      nodeIds: [],
      kind: mode === "hint" ? "hint" : "answer",
      pending: true,
    };
    setSession((old) => ({
      ...old,
      messages: [
        ...old.messages,
        ...(userText
          ? [
              {
                id: `${id}-user`,
                role: "user" as const,
                content: userText,
                nodeIds: baseIds,
                kind: "question" as const,
              },
            ]
          : []),
        pending,
      ],
      thoughts: isReply
        ? [
            ...old.thoughts,
            {
              id,
              text: userText,
              feedback: "",
              nodeIds: baseIds,
              status: "thinking",
            },
          ]
        : old.thoughts,
    }));
    setInput("");
    try {
      let action = "guided_socratic_start",
        params: Record<string, unknown> = { question: userText };
      const history = before.messages
        .filter((m) => !m.pending && !m.error)
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }));
      if (mode === "reply") {
        action = "guided_socratic_turn";
        params = {
          question: before.topic,
          answer: userText,
          turn: before.turn || 1,
          history,
        };
      }
      if (mode === "hint") {
        action = "guided_socratic_hint";
        params = { question: before.topic, level: before.hints + 1, history };
      }
      if (mode === "example" || mode === "explain") {
        action = "knowledge";
        params = {
          question: `${mode === "example" ? "请用一个具体的教学例子解释" : "请直接清楚地讲解"}：${userText}\n所属课程专题：${currentNetwork?.title || "基础设施规划"}。分段简洁说明概念、适用条件和常见误区；不编造资料出处，不要求学生先回答反问。`,
        };
      }
      const timeout = window.setTimeout(() => controller.abort(), 90000);
      let response: Response, data: ResponseData;
      try {
        response = await fetch("/api/agent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getAuthToken()}`,
          },
          body: JSON.stringify({ action, params }),
          signal: controller.signal,
        });
        data = await response.json();
      } finally {
        window.clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(data.error || "服务暂时不可用，请重试");
      if (seq !== sequence.current) return;
      const content =
        data.response || data.greeting || data.answer || data.hint;
      if (!content?.trim()) throw new Error("这次没有收到完整内容，请重试");
      const ids = applyContext(data.graphContext),
        done = data.status === "mastered" || data.status === "complete";
      const kind =
        mode === "hint"
          ? "hint"
          : done || mode === "example" || mode === "explain"
            ? "final"
            : "answer";
      const anchor = ids[0] || before.selectedId;
      setSession((old) => ({
        ...old,
        messages: old.messages.map((m) =>
          m.id === id
            ? { ...m, content, pending: false, nodeIds: ids, kind }
            : m,
        ),
        active:
          mode === "hint" ? old.active : mode === "guide" || (isReply && !done),
        topic: mode === "guide" ? userText : starting ? "" : old.topic,
        turn:
          mode === "guide"
            ? 1
            : isReply
              ? done
                ? 0
                : Math.min(3, before.turn + 1)
              : starting
                ? 0
                : old.turn,
        hints:
          mode === "hint"
            ? Math.min(4, old.hints + 1)
            : starting || done
              ? 0
              : old.hints,
        thoughts: old.thoughts.map((t) =>
          t.id === id
            ? {
                ...t,
                feedback: content,
                nodeIds: ids,
                status: done ? "summarized" : "revisit",
              }
            : t,
        ),
        visited: [...new Set([...old.visited, ...ids])],
        trail:
          anchor && mode !== "hint"
            ? [
                ...old.trail,
                {
                  id: uid(),
                  nodeId: anchor,
                  title: isReply
                    ? "补充了我的理解"
                    : `学习${nodes.get(anchor)?.name || "当前问题"}`,
                  detail: isReply ? userText : content.slice(0, 500),
                  kind: isReply ? ("answer" as const) : ("summary" as const),
                },
              ].slice(-80)
            : old.trail,
      }));
      if (done) {
        showToast("本轮已收束，可以练一题检查理解，或回放学习路径");
        fetch("/api/learning-events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getAuthToken()}`,
          },
          body: JSON.stringify({
            type: "GUIDED_COMPLETED",
            title: "完成一轮引导学习",
            summary: before.topic.slice(0, 100),
            refType: "guided",
          }),
        }).catch(() => undefined);
      }
    } catch (error) {
      if (seq !== sequence.current) return;
      const content = controller.signal.aborted
        ? "本次生成已停止或等待超时，已保留你的输入，可以重试。"
        : error instanceof Error
          ? error.message
          : "网络异常，请重试";
      setSession((old) => ({
        ...old,
        messages: old.messages.map((m) =>
          m.id === id
            ? {
                ...m,
                content,
                pending: false,
                error: true,
                retry: { question, mode },
              }
            : m,
        ),
        thoughts: old.thoughts.map((t) =>
          t.id === id
            ? {
                ...t,
                feedback: "本次反馈未完成，可以重新提交。",
                status: "revisit",
              }
            : t,
        ),
      }));
      if (userText) setInput(userText);
    } finally {
      if (seq === sequence.current) {
        setLoading(false);
        abort.current = null;
      }
    }
  };
  const startTopic = (
    question: string,
    mode: "guide" | "example" | "explain" = "guide",
  ) => {
    if (loading) return;
    if (session.active) {
      setPendingTopic({ question, mode });
      return;
    }
    runRequest(question, mode);
  };
  const explainNode = (mode: "guide" | "example" | "explain") => {
    if (selected)
      startTopic(
        `请帮助我理解“${selected.name}”及其在${selected.chapter}中的作用。`,
        mode,
      );
  };
  const showPanel = (next: Panel) => {
    setPanel(next);
    setMobile("work");
    setDetailOpen(false);
    setExplainWalk(null);
    if (next !== "replay") setPlaying(false);
  };
  const replayStep = (index: number) => {
    setPlaying(false);
    setReplayIndex(index);
    const t = session.trail[index];
    if (t) focusIds([t.nodeId]);
  };
  useEffect(() => {
    if (!playing || !session.trail.length) return;
    const index = Math.max(0, replayIndex),
      step = session.trail[index];
    if (step) focusIds([step.nodeId]);
    const timer = window.setTimeout(() => {
      if (index >= session.trail.length - 1) {
        setPlaying(false);
        showToast("回放完成，学习小结可以保存");
      } else setReplayIndex(index + 1);
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [playing, replayIndex, session.trail, focusIds, showToast]);

  const exportSummary = () => {
    const lines = [
      "# 基规智学 · 学习小结",
      "",
      `日期：${new Date().toLocaleDateString("zh-CN")}`,
      "",
      "## 我的发现",
      session.notes || "尚未填写个人总结。",
      "",
      "## 学习路径",
      ...session.trail.flatMap((t, i) => [
        `${i + 1}. ${t.title}`,
        `   ${t.detail.replace(/\n/g, "\n   ")}`,
        "",
      ]),
      "## 我的概念卡片",
      ...session.saved.flatMap((c) => [
        `### ${nodes.get(c.nodeId)?.name || c.nodeId}`,
        c.note || "尚未填写笔记。",
        "",
      ]),
      "## 我的思路",
      ...session.thoughts.flatMap((t) => [
        t.text,
        "",
        `反馈：${t.feedback}`,
        "",
      ]),
      "## 对话记录",
      ...session.messages
        .filter((m) => !m.pending)
        .flatMap((m) => [
          `### ${m.role === "user" ? "我" : "助教"}`,
          m.content,
          "",
        ]),
    ];
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `基规智学-学习小结-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  const resetSession = () => {
    abort.current?.abort();
    sequence.current++;
    setLoading(false);
    setSession((old) => ({
      ...emptySession(),
      saved: old.saved,
      links: old.links,
      notes: old.notes,
    }));
    setHighlighted([]);
    setInput("");
    setDetailOpen(false);
    setConfirmNew(false);
    setPlaying(false);
    setReplayIndex(-1);
    setViewMode("explore");
  };

  if (state.authLoading)
    return <div className="gx-root gx-loading">正在准备学习空间…</div>;
  if (!state.role)
    return (
      <div className="gx-root gx-loading">
        <h1>登录后开始探索</h1>
        <p>登录后可以使用引导学习并保存自己的学习记录。</p>
        <a href="/login">前往登录</a>
      </div>
    );
  if (loadError)
    return (
      <div className="gx-root gx-loading" role="alert">
        <h1>知识图谱暂时没有加载成功</h1>
        <p>{loadError}</p>
        <button onClick={() => setLoadVersion((v) => v + 1)}>重新加载</button>
      </div>
    );
  if (!ready)
    return (
      <div className="gx-root gx-loading">
        <span className="gx-loader" />
        <p>正在展开课程地图…</p>
      </div>
    );

  return (
    <div className="gx-root" ref={container}>
      <header className="gx-header">
        <div className="gx-brand">
          <span className="gx-brand-mark" aria-hidden>
            知
          </span>
          <div>
            <h1>知识探索与引导学习</h1>
            <p>看见关系，动手理解，留下自己的思路。</p>
          </div>
        </div>
        <div className="gx-header-actions">
          <span className="gx-visit-count">
            已探索 <b>{session.visited.length}</b> 个概念
          </span>
          <button onClick={() => showPanel("notes")}>
            整理区{" "}
            <span key={session.saved.length} className="gx-count gx-enter">
              {session.saved.length}
            </span>
          </button>
          <button
            onClick={exportSummary}
            disabled={
              !session.messages.length &&
              !session.trail.length &&
              !session.saved.length
            }
          >
            导出
          </button>
          <button onClick={() => setConfirmNew(true)} disabled={loading}>
            新一轮
          </button>
        </div>
      </header>
      <nav className="gx-network-nav" aria-label="课程专题">
        {networks.map((n) => (
          <button
            key={n.id}
            aria-current={session.activeNetwork === n.id ? "page" : undefined}
            onClick={() => switchNetwork(n.id)}
          >
            {n.chip}
          </button>
        ))}
      </nav>
      <div className="gx-breadcrumb">
        <button onClick={() => switchNetwork("overview")}>课程地图</button>
        {session.activeNetwork !== "overview" && (
          <>
            <span>›</span>
            <button onClick={() => switchNetwork(session.activeNetwork)}>
              {currentNetwork?.title}
            </button>
          </>
        )}
        {selected && selected.category !== "core" && (
          <>
            <span>›</span>
            <span>{selected.name}</span>
          </>
        )}
        <span className="gx-breadcrumb-note">
          {storageError
            ? "本地保存失败，请及时导出"
            : "探索记录自动保存在本浏览器"}
        </span>
      </div>
      <div className="gx-mobile-switch">
        <button
          aria-pressed={mobile === "graph"}
          onClick={() => setMobile("graph")}
        >
          知识图谱
        </button>
        <button
          aria-pressed={mobile === "work"}
          onClick={() => setMobile("work")}
        >
          {PANELS.find(([id]) => id === panel)?.[1]}
        </button>
      </div>
      <div
        className={`gx-workspace ${resizing ? "is-resizing" : ""}`}
        style={{ gridTemplateColumns: `${ratio}% 8px minmax(0, 1fr)` }}
      >
        <section
          className={`gx-graph-pane ${mobile === "graph" ? "is-mobile-active" : ""}`}
          aria-label="知识探索区"
        >
          <div className="gx-pane-heading">
            <div>
              <span className="gx-eyebrow">EXPLORE / 探索</span>
              <h2>{currentNetwork?.title}</h2>
            </div>
            <div className="gx-view-switch" role="group" aria-label="图谱范围">
              {(
                [
                  ["explore", "专题图"],
                  ["current", "当前问题"],
                  ["trail", "学习足迹"],
                ] as const
              ).map(([id, title]) => (
                <button
                  key={id}
                  aria-pressed={viewMode === id}
                  onClick={() => setViewMode(id)}
                >
                  {title}
                </button>
              ))}
            </div>
          </div>
          <Explorer
            graph={graph}
            selectedId={session.selectedId}
            highlighted={highlighted}
            visited={session.visited}
            viewMode={viewMode}
            focusRequest={focusRequest}
            onSelect={selectGraphNode}
            onCompare={addCompare}
            onCompareDrop={dropCompare}
            onSave={saveConcept}
          />
          <div className="gx-collection-tray">
            <span>拖入或点选</span>
            {[0, 1].map((slot) => (
              <button
                key={slot}
                data-concept-drop="compare"
                data-slot={slot}
                onClick={() => {
                  if (session.selectedId) dropCompare(session.selectedId, slot);
                  else showToast("先在图谱选择一个概念");
                }}
              >
                {nodes.get(compared[slot])?.name || `比较位 ${slot + 1}`}
              </button>
            ))}
            <button
              disabled={!compared[0] || !compared[1]}
              onClick={() => setCompareOpen(true)}
            >
              比较 ↗
            </button>
            <button
              data-concept-drop="save"
              onClick={() => {
                if (session.selectedId) saveConcept(session.selectedId);
                else showPanel("notes");
              }}
            >
              收藏到整理区
            </button>
            <button
              aria-label="图谱操作说明"
              onClick={() => setGraphHelp(!graphHelp)}
            >
              ?
            </button>
          </div>
          {graphHelp && (
            <div className="gx-graph-help">
              <button
                className="gx-close"
                aria-label="关闭操作说明"
                onClick={() => setGraphHelp(false)}
              >
                ×
              </button>
              <strong>怎样探索这张图</strong>
              <p>
                点击章节进入分支，点击节点看详情，点击连线了解关系。拖动画布移动视角，滚轮或双指缩放；节点可拖到下方比较位或整理区。
              </p>
              <p>
                也可以通过“目录”选择知识点，使用比较位按钮代替拖动。聚焦图谱后，方向键平移，＋
                / − 缩放。
              </p>
            </div>
          )}
          {detailOpen && selected && (
            <aside
              className="gx-detail gx-enter"
              aria-label={`${selected.name}概念详情`}
            >
              <button
                className="gx-close"
                aria-label="关闭概念详情"
                onClick={() => setDetailOpen(false)}
              >
                ×
              </button>
              <span className="gx-eyebrow">
                {categoryName(selected)} / {selected.chapter}
              </span>
              <h2>{selected.name}</h2>
              <p>{conceptContent(selected).definition}</p>
              <div className="gx-detail-example">
                <span className="gx-eyebrow">一个例子</span>
                <p>{conceptContent(selected).example}</p>
              </div>
              <details>
                <summary>容易混淆的地方</summary>
                <p>{conceptContent(selected).misconception}</p>
              </details>
              <div className="gx-actions">
                <button
                  className="gx-primary"
                  disabled={loading}
                  onClick={() => explainNode("guide")}
                >
                  带我理解
                </button>
                <button
                  disabled={loading}
                  onClick={() => explainNode("example")}
                >
                  看例子
                </button>
                <button
                  disabled={loading}
                  onClick={() => explainNode("explain")}
                >
                  直接讲解
                </button>
                <button onClick={() => showPanel("lab")}>动手看原理</button>
                <button onClick={() => showPanel("practice")}>练一练</button>
              </div>
              <div className="gx-detail-footer">
                <button onClick={() => addCompare(selected.id)}>
                  加入比较
                </button>
                <button onClick={() => saveConcept(selected.id)}>
                  收进整理区
                </button>
                <span>已浏览 · 不等同于已掌握</span>
              </div>
            </aside>
          )}
        </section>
        <div
          className="gx-resizer"
          role="separator"
          aria-label="调整图谱与学习区宽度"
          aria-valuenow={ratio}
          aria-valuemin={30}
          aria-valuemax={65}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setResizing(true);
          }}
          onPointerMove={(e) => {
            if (!resizing || !container.current) return;
            const rect = container.current.getBoundingClientRect();
            setRatio(
              Math.max(
                30,
                Math.min(65, ((e.clientX - rect.left) / rect.width) * 100),
              ),
            );
          }}
          onPointerUp={() => setResizing(false)}
          onPointerCancel={() => setResizing(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              setRatio((v) =>
                Math.max(
                  30,
                  Math.min(65, v + (e.key === "ArrowLeft" ? -2 : 2)),
                ),
              );
            }
          }}
          onDoubleClick={() => setRatio(50)}
        >
          <span />
        </div>
        <section
          className={`gx-learning-pane ${mobile === "work" ? "is-mobile-active" : ""}`}
          aria-label="互动学习区"
        >
          <nav className="gx-panel-tabs" aria-label="学习工具">
            {PANELS.map(([id, title]) => (
              <button
                key={id}
                aria-current={panel === id ? "page" : undefined}
                onClick={() => showPanel(id)}
              >
                {title}
                {id === "notes" && session.thoughts.length > 0 && (
                  <span className="gx-dot" />
                )}
              </button>
            ))}
          </nav>
          {panel === "learn" ? (
            <>
              {session.active && (
                <div className="gx-topic">
                  <span className="gx-status-dot" />
                  <div>
                    <small>当前思考 · 第 {session.turn} / 3 步</small>
                    <strong>{session.topic}</strong>
                  </div>
                  <button
                    disabled={loading}
                    onClick={() => {
                      patch({ active: false, topic: "", turn: 0, hints: 0 });
                      showToast("本轮已结束，记录保留在思路卡和学习路径中");
                    }}
                  >
                    结束本轮
                  </button>
                </div>
              )}
              <div
                className="gx-chat-scroll"
                ref={chatScroll}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  followBottom.current =
                    el.scrollHeight - el.clientHeight - el.scrollTop < 100;
                }}
              >
                {!session.messages.length && (
                  <div className="gx-welcome gx-enter">
                    <span className="gx-eyebrow">从一个小问题开始</span>
                    <h2>
                      让知识之间的联系
                      <br />
                      慢慢清晰起来。
                    </h2>
                    <p>
                      点击左侧知识点，或者选择下面的问题。你可以一步步思考，也可以先看例子、直接听讲解。
                    </p>
                    <div className="gx-suggestions">
                      {(
                        SUGGESTIONS[session.activeNetwork] ||
                        SUGGESTIONS.overview
                      ).map((q, i) => (
                        <button key={q} onClick={() => startTopic(q)}>
                          <span>0{i + 1}</span>
                          <strong>{q}</strong>
                          <span>↗</span>
                        </button>
                      ))}
                    </div>
                    <div className="gx-welcome-actions">
                      <button onClick={() => showPanel("lab")}>
                        先操作一个原理演示 →
                      </button>
                      <button onClick={() => showPanel("practice")}>
                        从一道小练习开始 →
                      </button>
                    </div>
                  </div>
                )}
                {session.messages.map((m) => (
                  <article
                    key={m.id}
                    className={`gx-message gx-enter ${m.role} ${m.kind} ${m.error ? "is-error" : ""}`}
                  >
                    <div className="gx-message-label">
                      {m.role === "user"
                        ? "我的想法"
                        : m.kind === "hint"
                          ? "给你一个线索"
                          : m.kind === "final"
                            ? "这一轮的讲解"
                            : "引导助教"}
                    </div>
                    <div className="gx-message-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {m.content}
                      </ReactMarkdown>
                      {m.pending && (
                        <span className="gx-thinking" aria-label="正在生成">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                    </div>
                    {m.role === "assistant" &&
                      !m.pending &&
                      !m.error &&
                      m.nodeIds.length > 0 && (
                        <div className="gx-message-concepts">
                          <span>关联概念</span>
                          {m.nodeIds.slice(0, 5).map((id) => (
                            <button
                              key={id}
                              onClick={() => focusIds([id], true)}
                            >
                              {nodes.get(id)?.name}
                            </button>
                          ))}
                          <button
                            className="gx-link"
                            onClick={() => focusIds(m.nodeIds, true)}
                          >
                            查看这段讲解的关系 ↗
                          </button>
                          <button
                            className="gx-link"
                            onClick={() => {
                              setPlaying(false);
                              setExplainWalk((old) =>
                                old?.messageId === m.id && old.playing
                                  ? { ...old, playing: false }
                                  : {
                                      messageId: m.id,
                                      ids: m.nodeIds,
                                      index: 0,
                                      playing: true,
                                    },
                              );
                            }}
                          >
                            {explainWalk?.messageId === m.id &&
                            explainWalk.playing
                              ? "暂停概念联动"
                              : "逐个点亮关联概念 ▷"}
                          </button>
                          {explainWalk?.messageId === m.id && (
                            <div className="gx-explain-walk" aria-live="polite">
                              <span>
                                {explainWalk.index + 1} /{" "}
                                {explainWalk.ids.length} ·{" "}
                                {
                                  nodes.get(explainWalk.ids[explainWalk.index])
                                    ?.name
                                }
                              </span>
                              <button
                                disabled={explainWalk.index === 0}
                                onClick={() => {
                                  const index = explainWalk.index - 1;
                                  setExplainWalk({
                                    ...explainWalk,
                                    index,
                                    playing: false,
                                  });
                                  focusIds([explainWalk.ids[index]]);
                                }}
                              >
                                上一个
                              </button>
                              <button
                                disabled={
                                  explainWalk.index ===
                                  explainWalk.ids.length - 1
                                }
                                onClick={() => {
                                  const index = explainWalk.index + 1;
                                  setExplainWalk({
                                    ...explainWalk,
                                    index,
                                    playing: false,
                                  });
                                  focusIds([explainWalk.ids[index]]);
                                }}
                              >
                                下一个
                              </button>
                              <button onClick={() => setExplainWalk(null)}>
                                结束
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    {m.kind === "final" && !m.error && (
                      <div className="gx-actions">
                        <button onClick={() => showPanel("practice")}>
                          练一题
                        </button>
                        <button onClick={() => showPanel("replay")}>
                          回看学习路径
                        </button>
                      </div>
                    )}
                    {m.error && (
                      <button
                        onClick={() =>
                          runRequest(
                            m.retry?.question || input || session.topic,
                            m.retry?.mode ||
                              (session.active ? "reply" : "guide"),
                          )
                        }
                        disabled={
                          loading ||
                          !(m.retry?.question || input || session.topic)
                        }
                      >
                        重试
                      </button>
                    )}
                  </article>
                ))}
              </div>
              <div className="gx-composer">
                <div className="gx-composer-tools">
                  {session.active ? (
                    <>
                      <button
                        disabled={loading || session.hints >= 4}
                        onClick={() => runRequest(session.topic, "hint")}
                      >
                        给点提示 {session.hints}/4
                      </button>
                      <button
                        disabled={loading}
                        onClick={() => startTopic(session.topic, "example")}
                      >
                        换个例子
                      </button>
                      <button
                        disabled={loading}
                        onClick={() => startTopic(session.topic, "explain")}
                      >
                        直接讲解
                      </button>
                    </>
                  ) : (
                    <span>
                      {selected
                        ? `围绕“${selected.name}”继续探索`
                        : "每次只需写下一个问题或想法"}
                    </span>
                  )}
                  {loading && (
                    <button onClick={() => abort.current?.abort()}>
                      停止生成
                    </button>
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    runRequest(input, session.active ? "reply" : "guide");
                  }}
                >
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      session.active
                        ? "写下你的判断，以及为什么这样想…"
                        : "输入想学习的问题…"
                    }
                    aria-label="学习问题或回答"
                    rows={2}
                    maxLength={6000}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        runRequest(input, session.active ? "reply" : "guide");
                      }
                    }}
                  />
                  <button
                    className="gx-primary"
                    type="submit"
                    disabled={loading || !input.trim()}
                  >
                    {loading
                      ? "思考中"
                      : session.active
                        ? "提交想法 ↑"
                        : "开始思考 ↑"}
                  </button>
                </form>
                <small>
                  Enter 发送 · Shift + Enter 换行 · 回答会形成自己的思路卡
                </small>
              </div>
            </>
          ) : (
            <div className="gx-tool-scroll" key={panel}>
              {panel === "lab" && (
                <ConceptLab
                  network={session.activeNetwork}
                  name={selected?.name}
                  onFocus={focusNames}
                  onActivity={activity}
                />
              )}
              {panel === "practice" && (
                <PracticePanel onFocus={focusNames} onResult={practiceResult} />
              )}
              {panel === "notes" && (
                <Notebook
                  nodes={nodes}
                  saved={session.saved}
                  links={session.links}
                  thoughts={session.thoughts}
                  notes={session.notes}
                  onSaved={(saved) => patch({ saved })}
                  onLinks={(links) => patch({ links })}
                  onNotes={(notes) => patch({ notes })}
                  onFocus={(ids) => focusIds(ids, true)}
                  onRevisit={(text) => {
                    setInput(text);
                    showPanel("learn");
                  }}
                />
              )}
              {panel === "replay" && (
                <Replay
                  trail={session.trail}
                  current={replayIndex}
                  playing={playing}
                  onPlay={() => {
                    if (
                      replayIndex < 0 ||
                      replayIndex >= session.trail.length - 1
                    )
                      setReplayIndex(0);
                    setPlaying(true);
                  }}
                  onPause={() => setPlaying(false)}
                  onStep={replayStep}
                  onStop={() => {
                    setPlaying(false);
                    setReplayIndex(-1);
                    setHighlighted([]);
                  }}
                  onExport={exportSummary}
                />
              )}
            </div>
          )}
        </section>
      </div>
      {compareOpen && (
        <div className="gx-overlay" onClick={() => setCompareOpen(false)}>
          <section
            className="gx-compare gx-enter"
            role="dialog"
            aria-modal="true"
            aria-label="知识点比较"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="gx-close"
              onClick={() => setCompareOpen(false)}
              aria-label="关闭比较"
            >
              ×
            </button>
            <span className="gx-eyebrow">放在一起，更容易看清</span>
            <h2>比较两个概念</h2>
            <div className="gx-compare-pickers">
              {[0, 1].map((index) => (
                <label key={index}>
                  概念 {index + 1}
                  <select
                    aria-label={`选择比较概念${index + 1}`}
                    value={compared[index] || ""}
                    onChange={(e) =>
                      setCompared((old) => {
                        const next = [...old];
                        next[index] = e.target.value;
                        return next;
                      })
                    }
                  >
                    <option value="">选择知识点</option>
                    {allGraph.nodes
                      .filter(
                        (n) =>
                          n.category !== "core" && n.category !== "category",
                      )
                      .map((n) => (
                        <option
                          key={n.id}
                          value={n.id}
                          disabled={compared[1 - index] === n.id}
                        >
                          {n.name} · {n.chapter}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="gx-tabs">
              {[
                ["definition", "是什么"],
                ["example", "看例子"],
                ["condition", "适用条件"],
                ["misconception", "容易混淆"],
              ].map(([id, title]) => (
                <button
                  key={id}
                  aria-pressed={compareAspect === id}
                  onClick={() => setCompareAspect(id)}
                >
                  {title}
                </button>
              ))}
            </div>
            <div className="gx-compare-columns">
              {[0, 1].map((index) => {
                const node = nodes.get(compared[index]);
                return node ? (
                  <article
                    key={`${node.id}-${compareAspect}`}
                    className="gx-enter"
                  >
                    <span className="gx-eyebrow">{node.chapter}</span>
                    <h3>{node.name}</h3>
                    <p>
                      {
                        conceptContent(node)[
                          compareAspect as keyof ReturnType<
                            typeof conceptContent
                          >
                        ]
                      }
                    </p>
                    <div className="gx-actions">
                      <button
                        onClick={() => {
                          choose(node);
                          setCompareOpen(false);
                          setMobile("graph");
                        }}
                      >
                        在图谱查看
                      </button>
                      <button onClick={() => saveConcept(node.id)}>
                        收进整理区
                      </button>
                    </div>
                  </article>
                ) : (
                  <div key={index} className="gx-compare-placeholder">
                    从上方选择一个概念开始比较
                  </div>
                );
              })}
            </div>
            {compared.length === 2 &&
              nodes.has(compared[0]) &&
              nodes.has(compared[1]) && (
                <div className="gx-actions">
                  <button
                    className="gx-primary"
                    disabled={loading}
                    onClick={() => {
                      setCompareOpen(false);
                      startTopic(
                        `请比较“${nodes.get(compared[0])!.name}”与“${nodes.get(compared[1])!.name}”的作用、条件和局限。`,
                        "explain",
                      );
                    }}
                  >
                    请助教解释差异
                  </button>
                  <button
                    onClick={() => {
                      setCompareOpen(false);
                      showPanel("lab");
                    }}
                  >
                    去原理演示中观察
                  </button>
                </div>
              )}
          </section>
        </div>
      )}
      {pendingTopic && (
        <div className="gx-overlay">
          <section
            className="gx-confirm gx-enter"
            role="dialog"
            aria-modal="true"
            aria-label="切换学习主题"
          >
            <h2>结束当前追问，开始这段学习？</h2>
            <p>之前的回答会保留在思路卡和学习路径里。</p>
            <blockquote>{pendingTopic.question}</blockquote>
            <div className="gx-actions">
              <button
                className="gx-primary"
                onClick={() => {
                  const next = pendingTopic;
                  setPendingTopic(null);
                  runRequest(next.question, next.mode);
                }}
              >
                继续新的学习
              </button>
              <button onClick={() => setPendingTopic(null)}>
                回到当前问题
              </button>
            </div>
          </section>
        </div>
      )}
      {confirmNew && (
        <div className="gx-overlay">
          <section
            className="gx-confirm gx-enter"
            role="dialog"
            aria-modal="true"
            aria-label="开始新一轮学习"
          >
            <h2>开始新一轮探索</h2>
            <p>本轮对话、思路和路径会清空。收集的概念卡与个人笔记会保留。</p>
            <div className="gx-actions">
              <button onClick={exportSummary}>先保存学习小结</button>
              <button className="gx-primary" onClick={resetSession}>
                开始新一轮
              </button>
              <button onClick={() => setConfirmNew(false)}>取消</button>
            </div>
          </section>
        </div>
      )}
      {toast && (
        <div className="gx-toast gx-enter" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
