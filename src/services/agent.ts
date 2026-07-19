import { AgentResponse } from "@/types";
import { searchKnowledge } from "@/data/knowledge-base";
import { mockKnowledgeResponses } from "@/data/mock-responses";
import { guidedScenarios } from "@/data/guided-scenarios";
import { supabase } from "@/lib/supabase";

const AGENT_API = "/api/agent";

// ── Helper: get auth header for Netlify Function calls ──
async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.session?.access_token || ""}`,
  };
}

// ── Helper: call the Netlify Function (Claude API proxy) ──
async function callAgent(action: string, params: Record<string, any>) {
  const headers = await getAuthHeaders();
  const res = await fetch(AGENT_API, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, params }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "AI 服务暂时不可用" }));
    throw new Error(err.error || "AI 服务错误");
  }

  return res.json();
}

// ========== Knowledge Agent ==========
export async function queryKnowledgeAgent(
  question: string
): Promise<AgentResponse> {
  try {
    // Search local knowledge base for context
    const searchResult = searchKnowledge(question);
    const context =
      searchResult.references.length > 0
        ? searchResult.references
            .map((r) => `[${r.docName} ${r.chapter} p${r.page}]\n${r.snippet}`)
            .join("\n\n")
        : "";

    const result = await callAgent("knowledge", { question, context });

    return {
      answer: result.answer,
      references: searchResult.references,
    };
  } catch (err: any) {
    // Fallback to local keyword matching if API fails
    const lowerQ = question.toLowerCase();
    for (const mock of mockKnowledgeResponses) {
      const matchCount = mock.keywords.filter((kw: string) =>
        lowerQ.includes(kw)
      ).length;
      if (matchCount >= 2) {
        return {
          answer: mock.answer,
          references: mock.references,
        };
      }
    }

    return {
      answer: "抱歉，当前 AI 服务暂时不可用。请稍后再试。\n\n（离线模式：我暂时无法回答这个问题。）",
      references: [],
    };
  }
}

// ========== Guided Learning Agent ==========
export async function startGuidedScenario(scenarioId: string) {
  const scenario = guidedScenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

  const firstStep = scenario.steps[0];

  try {
    const result = await callAgent("guided_start", {
      scenarioTitle: scenario.title,
      scenarioDescription: scenario.description,
      firstQuestion: firstStep.question,
      totalSteps: firstStep.totalSteps,
    });

    return {
      greeting: result.greeting,
      firstQuestion: result.firstQuestion || firstStep.question,
      step: 1,
      totalSteps: firstStep.totalSteps,
    };
  } catch {
    // Fallback to local
    return {
      greeting: `欢迎进入「${scenario.title}」引导学习！${scenario.description}。我会通过 ${firstStep.totalSteps} 个问题逐步引导你深入理解这个主题。准备好了吗？让我们开始吧！`,
      firstQuestion: firstStep.question,
      step: 1,
      totalSteps: firstStep.totalSteps,
    };
  }
}

export async function evaluateGuidedAnswer(
  scenarioId: string,
  currentStep: number,
  studentAnswer: string
) {
  const scenario = guidedScenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

  const stepData = scenario.steps[currentStep - 1];
  if (!stepData) {
    return { feedback: "引导已完成！", isComplete: true, explanation: "" };
  }

  const isLastStep = currentStep >= stepData.totalSteps;
  const nextStep = isLastStep ? null : scenario.steps[currentStep];

  try {
    const result = await callAgent("guided_evaluate", {
      scenarioTitle: scenario.title,
      scenarioDescription: scenario.description,
      stepNumber: currentStep,
      totalSteps: stepData.totalSteps,
      question: stepData.question,
      expectedAnswer: stepData.expectedAnswer || "",
      studentAnswer,
    });

    return {
      feedback: result.feedback,
      nextQuestion: isLastStep
        ? undefined
        : nextStep?.question || result.feedback,
      isComplete: isLastStep,
      explanation: result.explanation,
    };
  } catch {
    // Fallback
    const isSubstantial = studentAnswer.length > 10;
    return {
      feedback: isSubstantial
        ? stepData.explanation
        : "你的回答比较简短，试着展开说一下？",
      nextQuestion: nextStep?.question,
      isComplete: isLastStep,
      explanation: stepData.explanation,
    };
  }
}

export async function getHint(
  scenarioId: string,
  currentStep: number,
  hintsUsed: number
) {
  const scenario = guidedScenarios.find((s) => s.id === scenarioId);
  if (!scenario) return "当前场景不可用。";

  const stepData = scenario.steps[currentStep - 1];
  if (!stepData) return "当前步骤没有可用的提示。";

  try {
    const result = await callAgent("guided_hint", {
      question: stepData.question,
      hintsUsed,
    });
    return result.hint;
  } catch {
    const hintIndex = Math.min(hintsUsed, stepData.hints.length - 1);
    return stepData.hints[hintIndex];
  }
}

// ========== Sandbox Agent ==========
export async function querySandboxAgent(
  question: string,
  context?: {
    intensity: number;
    duration: number;
    maxDepth: number;
    floodArea: number;
  }
): Promise<AgentResponse> {
  if (!context) {
    return { answer: "请先运行模拟，然后我可以帮您分析结果。" };
  }

  try {
    const result = await callAgent("sandbox", {
      question,
      simulation: context,
    });

    return {
      answer: result.answer,
    };
  } catch {
    return {
      answer: `当前模拟参数：降雨强度 ${context.intensity}mm/h，历时 ${context.duration}min。\n\n最大积水深度 ${context.maxDepth}m，积水面积 ${context.floodArea}km²。\n\nAI 分析暂时不可用，请稍后再试。`,
    };
  }
}
