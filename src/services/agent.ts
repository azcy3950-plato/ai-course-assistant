import { AgentResponse, Message } from '@/types';
import { searchKnowledge } from '@/data/knowledge-base';
import { mockKnowledgeResponses, fallbackResponse } from '@/data/mock-responses';
import { guidedScenarios } from '@/data/guided-scenarios';

// Simulate network delay
function delay(ms: number = 800): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms + Math.random() * 700));
}

// ========== Knowledge Agent ==========
export async function queryKnowledgeAgent(question: string): Promise<AgentResponse> {
  await delay();

  // First try to match against curated mock responses
  const lowerQ = question.toLowerCase();
  for (const mock of mockKnowledgeResponses) {
    const matchCount = mock.keywords.filter(kw => lowerQ.includes(kw)).length;
    if (matchCount >= 2) {
      return {
        answer: mock.answer,
        references: mock.references,
      };
    }
  }

  // Fallback to keyword search in knowledge base
  const result = searchKnowledge(question);

  if (result.references.length > 0) {
    // Construct answer from found fragments
    const answer = `根据知识库检索结果，为您找到以下相关内容：\n\n${result.content}\n\n---\n*以上内容来自知识库检索匹配，如需更精确的答案，请尝试使用更具体的术语提问。*`;

    return {
      answer,
      references: result.references,
    };
  }

  return {
    answer: fallbackResponse.answer,
    references: [],
  };
}

// ========== Guided Learning Agent ==========
export async function startGuidedScenario(scenarioId: string): Promise<{
  greeting: string;
  firstQuestion: string;
  step: number;
  totalSteps: number;
}> {
  await delay(500);

  const scenario = guidedScenarios.find(s => s.id === scenarioId);
  if (!scenario) {
    throw new Error(`Scenario ${scenarioId} not found`);
  }

  const firstStep = scenario.steps[0];

  return {
    greeting: `欢迎进入「${scenario.title}」引导学习！${scenario.description}。我会通过 ${firstStep.totalSteps} 个问题逐步引导你深入理解这个主题。准备好了吗？让我们开始吧！`,
    firstQuestion: firstStep.question,
    step: 1,
    totalSteps: firstStep.totalSteps,
  };
}

export async function evaluateGuidedAnswer(
  scenarioId: string,
  currentStep: number,
  studentAnswer: string
): Promise<{
  feedback: string;
  nextQuestion?: string;
  isComplete: boolean;
  explanation: string;
}> {
  await delay(1000);

  const scenario = guidedScenarios.find(s => s.id === scenarioId);
  if (!scenario) {
    throw new Error(`Scenario ${scenarioId} not found`);
  }

  const stepData = scenario.steps[currentStep - 1];
  if (!stepData) {
    return {
      feedback: '引导已完成！',
      isComplete: true,
      explanation: '',
    };
  }

  const isLastStep = currentStep >= stepData.totalSteps;
  const nextStep = isLastStep ? null : scenario.steps[currentStep];

  // Simple evaluation: check if answer is substantial enough
  const isSubstantial = studentAnswer.length > 10;

  if (!isSubstantial) {
    return {
      feedback: '你的回答比较简短，能不能试着展开说一下你的想法？即使不太确定也没关系，思考的过程比答案本身更重要！',
      nextQuestion: stepData.question,
      isComplete: false,
      explanation: '',
    };
  }

  return {
    feedback: stepData.explanation,
    nextQuestion: nextStep?.question,
    isComplete: isLastStep,
    explanation: stepData.explanation,
  };
}

export async function getHint(
  scenarioId: string,
  currentStep: number,
  hintsUsed: number
): Promise<string> {
  await delay(500);

  const scenario = guidedScenarios.find(s => s.id === scenarioId);
  if (!scenario) return '当前场景不可用。';

  const stepData = scenario.steps[currentStep - 1];
  if (!stepData) return '当前步骤没有可用的提示。';

  const hintIndex = Math.min(hintsUsed, stepData.hints.length - 1);
  return stepData.hints[hintIndex];
}

// ========== Sandbox Agent ==========
export async function querySandboxAgent(
  question: string,
  context?: { intensity: number; duration: number; maxDepth: number; floodArea: number }
): Promise<AgentResponse> {
  await delay(600);

  if (!context) {
    return {
      answer: '请先运行模拟，然后我可以帮您分析结果。',
    };
  }

  const lowerQ = question.toLowerCase();

  if (lowerQ.includes('积水') || lowerQ.includes('严重') || lowerQ.includes('why')) {
    return {
      answer: `根据当前模拟结果分析（降雨强度${context.intensity}mm/h，历时${context.duration}min）：\n\n积水较严重的区域主要集中在低洼地带和排水管网不完善的区域。最大积水深度达到${context.maxDepth}m，主要因为：\n\n1. **地形因素**：低洼区域雨水自然汇集，排水不畅\n2. **管网能力不足**：该区域管道设计标准偏低，无法应对当前强度的降雨\n3. **不透水面积大**：周边建筑密集，雨水下渗量小\n\n建议关注积水深度超过0.3m的高风险区域，这些区域可能对行人和车辆造成危险。`,
      references: [
        {
          id: 1,
          docName: '城市排水系统工程.pdf',
          chapter: '第二章 内涝成因分析',
          page: 12,
          snippet: '城市内涝的主要成因包括：极端降雨事件频发、排水系统设计标准偏低、城市不透水面积增加。',
        },
      ],
    };
  }

  if (lowerQ.includes('改进') || lowerQ.includes('方案') || lowerQ.includes('解决')) {
    return {
      answer: `针对当前模拟场景（${context.intensity}mm/h 降雨，积水面积${context.floodArea}km²），建议以下改进方案：\n\n**短期措施：**\n- 在积水严重区域增设移动泵站\n- 清理排水管道，确保通畅\n- 在低洼点设置警示标志\n\n**长期措施：**\n- 提高该区域排水管网设计标准\n- 建设雨水调蓄池\n- 推广海绵城市措施（透水铺装、下沉式绿地）`,
      references: [
        {
          id: 1,
          docName: '城市内涝防治技术指南.pdf',
          chapter: '防治措施',
          page: 22,
          snippet: '城市内涝防治体系分为工程措施和非工程措施两大类。工程措施包括管网改造、调蓄设施建设、河道整治等。',
        },
      ],
    };
  }

  return {
    answer: `当前模拟参数：降雨强度 ${context.intensity}mm/h，历时 ${context.duration}min。\n\n模拟结果：最大积水深度 ${context.maxDepth}m，积水面积 ${context.floodArea}km²。\n\n您可以通过调整左侧参数来观察不同降雨条件下的积水变化，也可以拖动下方时间轴查看积水随时间的变化过程。`,
  };
}
