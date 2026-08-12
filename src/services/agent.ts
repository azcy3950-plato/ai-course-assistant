import type {
  AgentResponse,
  GraphContext,
  KnowledgeGraphResponse,
  Reference,
  StudentNodeProgress,
} from "@/types";
import { guidedScenarios } from "@/data/guided-scenarios";

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("aicourse-token") || "";
}

export async function queryKnowledgeAgentStream(
  question: string,
  onChunk: (text: string) => void,
  onRefs?: (refs: Reference[]) => void,
  onGraphContext?: (context: GraphContext) => void,
): Promise<AgentResponse> {
  const token = getToken();
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "knowledge_stream", params: { question } }),
  });
  if (!res.ok || !res.body) throw new Error("Stream failed");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let refs: Reference[] = [];
  let graphContext: GraphContext | undefined;
  let buffer = "";
  let metadataRead = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (!metadataRead) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) continue;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      metadataRead = true;
      try {
        if (line.startsWith("__META__")) {
          const metadata = JSON.parse(line.slice(8));
          refs = mapReferences(metadata.references || []);
          graphContext = metadata.graphContext;
          onRefs?.(refs);
          if (graphContext) onGraphContext?.(graphContext);
        } else if (line.startsWith("__REFS__")) {
          refs = mapReferences(JSON.parse(line.slice(8)));
          onRefs?.(refs);
        } else {
          buffer = `${line}\n${buffer}`;
        }
      } catch (err) {
        // A malformed metadata header should not discard the answer stream, but log it for diagnosis
        console.warn("[agent-stream] metadata parse failed:", line.slice(0, 80), err);
      }
    }
    fullText += buffer;
    buffer = "";
    onChunk(fullText);
  }
  fullText += decoder.decode();
  return { answer: fullText, references: refs, graphContext };
}

function mapReferences(rawReferences: any[]): Reference[] {
  return rawReferences.map((reference) => ({
    id: reference.id,
    docName: reference.docName,
    chapter: reference.chapter || "",
    snippet: reference.content || reference.snippet || "",
    page: Number(reference.page || 0),
    fileUrl: reference.fileUrl || "",
  }));
}

const AGENT_API = "/api/agent";

async function getAuthHeaders() {
  return { "Content-Type": "application/json", Authorization: "Bearer " + getToken() };
}

async function callAgent(action: string, params: Record<string, any>) {
  const headers = await getAuthHeaders();
  const res = await fetch(AGENT_API, { method: "POST", headers, body: JSON.stringify({ action, params }) });
  if (!res.ok) throw new Error("AI服务错误");
  return res.json();
}

export async function queryKnowledgeAgent(question: string): Promise<AgentResponse> {
  try {
    const result = await callAgent("knowledge", { question });
    return {
      answer: result.answer,
      references: mapReferences(result.references || []),
      graphContext: result.graphContext,
    };
  } catch {
    return { answer: "抱歉，AI服务暂时不可用，请稍后再试。", references: [] };
  }
}

export async function getKnowledgeGraph(): Promise<KnowledgeGraphResponse> {
  const res = await fetch("/api/knowledge-graph", { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error("知识图谱加载失败");
  return res.json();
}

export async function recordKnowledgeNodeInteraction(
  nodeId: string,
  kind: "question" | "study" = "study",
): Promise<StudentNodeProgress | undefined> {
  const res = await fetch("/api/knowledge-graph", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ action: "record_interaction", nodeId, kind }),
  });
  if (!res.ok) return undefined;
  return (await res.json()).progress;
}

export async function generateKnowledgeNodeQuiz(nodeId: string) {
  const result = await callAgent("node_quiz", { nodeId });
  return result.questions || [];
}

export async function startGuidedScenario(scenarioId: string) {
  const scenario = guidedScenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error("Scenario not found");
  const firstStep = scenario.steps[0];
  try {
    const result = await callAgent("guided_start", {
      scenarioTitle: scenario.title,
      scenarioDescription: scenario.description,
      firstQuestion: firstStep.question,
      totalSteps: firstStep.totalSteps,
    });
    return { greeting: result.greeting, firstQuestion: result.firstQuestion || firstStep.question, step: 1, totalSteps: firstStep.totalSteps };
  } catch {
    return { greeting: "欢迎进入" + scenario.title + "！", firstQuestion: firstStep.question, step: 1, totalSteps: firstStep.totalSteps };
  }
}

export async function evaluateGuidedAnswer(scenarioId: string, currentStep: number, studentAnswer: string) {
  const scenario = guidedScenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error("Scenario not found");
  const stepData = scenario.steps[currentStep - 1];
  if (!stepData) return { feedback: "引导已完成！", isComplete: true, explanation: "" };
  const isLastStep = currentStep >= stepData.totalSteps;
  const nextStep = isLastStep ? null : scenario.steps[currentStep];
  try {
    const result = await callAgent("guided_evaluate", {
      scenarioTitle: scenario.title,
      stepNumber: currentStep,
      totalSteps: stepData.totalSteps,
      question: stepData.question,
      expectedAnswer: stepData.expectedAnswer || "",
      studentAnswer,
    });
    return { feedback: result.feedback, nextQuestion: isLastStep ? undefined : nextStep?.question, isComplete: isLastStep, explanation: result.explanation };
  } catch {
    return { feedback: studentAnswer.length > 10 ? stepData.explanation : "试着展开说一下？", nextQuestion: nextStep?.question, isComplete: isLastStep, explanation: stepData.explanation };
  }
}

export async function getHint(scenarioId: string, currentStep: number, hintsUsed: number) {
  const scenario = guidedScenarios.find((s) => s.id === scenarioId);
  if (!scenario) return "场景不可用。";
  const stepData = scenario.steps[currentStep - 1];
  if (!stepData) return "无提示。";
  try {
    const result = await callAgent("guided_hint", { question: stepData.question, hintsUsed });
    return result.hint;
  } catch { return stepData.hints[Math.min(hintsUsed, stepData.hints.length - 1)]; }
}

export async function querySandboxAgent(question: string, context?: { intensity: number; duration: number; maxDepth: number; floodArea: number }): Promise<AgentResponse> {
  if (!context) return { answer: "请先运行模拟。" };
  try {
    const result = await callAgent("sandbox", { question, simulation: context });
    return { answer: result.answer, references: [] };
  } catch { return { answer: "AI分析暂时不可用。", references: [] }; }
}
