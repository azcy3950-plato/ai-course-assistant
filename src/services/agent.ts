import { AgentResponse, Reference } from "@/types";
import { guidedScenarios } from "@/data/guided-scenarios";

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("aicourse-token") || "";
}

export async function queryKnowledgeAgentStream(
  question: string,
  onChunk: (text: string) => void,
  onRefs?: (refs: Reference[]) => void
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
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Check for references prefix
    if (buffer.startsWith("__REFS__")) {
      const nl = buffer.indexOf("\n");
      if (nl > 0) {
        try {
          const rawRefs = JSON.parse(buffer.slice(8, nl));
          refs = rawRefs.map((r: any) => ({
            id: r.id, docName: r.docName, chapter: r.chapter || "",
            snippet: r.content || "", page: 0, fileUrl: r.fileUrl || "",
          }));
          if (onRefs) onRefs(refs);
        } catch(e) {}
        buffer = buffer.slice(nl + 1);
      }
    }
    fullText += buffer;
    buffer = "";
    onChunk(fullText);
  }
  return { answer: fullText, references: refs };
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
    const refs = (result.references || []).map((r: any) => ({
      id: r.id,
      docName: r.docName,
      chapter: r.chapter || "",
      snippet: r.content || "",
      page: 0,
      fileUrl: r.fileUrl || "",
    }));
    return { answer: result.answer, references: refs };
  } catch {
    return { answer: "抱歉，AI服务暂时不可用，请稍后再试。", references: [] };
  }
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
