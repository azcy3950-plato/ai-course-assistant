import type { KnowledgeGraph, KnowledgeNode } from '@/types';

export type MentorMode = 'guided' | 'quiz' | 'explore';
export type LessonStep = {
  id: string; nodeNames: string[]; title: string; question: string;
  options: { id: string; text: string; feedback: string }[];
  correctOption: string; hints: [string, string, string];
  explanation: string; example: string; reflection: string;
};
export type MentorLesson = {
  id: string; title: string; subtitle: string; network: string; minutes: number;
  steps: LessonStep[]; experiment?: 'rain-garden' | 'permeable-paving';
};

// Teaching sequences, not new graph edges. Concepts follow the existing course
// cards in components/guided/learning-content.ts; no external character assets.
export const MENTOR_LESSONS: MentorLesson[] = [
  { id: 'rain-garden', title: '一场雨，能有多少种去处？', subtitle: '从下渗、滞蓄到雨水花园，理解水去了哪里。', network: 'sponge', minutes: 8, experiment: 'rain-garden', steps: [
    { id: 'infiltration', nodeNames: ['渗透'], title: '先找雨水的去处', question: '相同的雨落在硬地和绿地上。土壤有入渗能力时，绿地最可能多提供哪条去路？', options: [
      { id: 'a', text: '让全部雨水立即蒸发', feedback: '把蒸散和下渗混在一起了。蒸散需要时间，不能让一场雨立即消失。' },
      { id: 'b', text: '让部分水进入土壤孔隙', feedback: '对，你找到了下渗这条路径。注意是“部分”，土壤的接纳能力有限。' },
      { id: 'c', text: '只要有植物，就不会产生径流', feedback: '忽略了土壤饱和与降雨强度。绿地也可能产流，植物不是无限容量的容器。' },
    ], correctOption: 'b', hints: ['先区分水从地表流走和进入土壤。', '看看图谱中的“渗透”：水通过什么空间进入土壤？', '关键是“土壤孔隙”和“有限能力”，不是让雨水凭空消失。'], explanation: '下渗是水从地表进入土壤的过程。它受土壤性质、含水状态和地下水条件影响，超出能力的来水仍可能形成地表径流。', example: '持续降雨后，原本能吸水的草地也开始积水，说明其接纳能力发生了变化。', reflection: '用一句话解释：为什么有绿地仍然会积水？' },
    { id: 'detention', nodeNames: ['储存', '调节'], title: '水量和流量，是一回事吗？', question: '一个池子先接住雨水，之后慢慢排空。即使排出的总水量相近，它仍可能改善什么？', options: [
      { id: 'a', text: '把水留一会儿，降低同一时刻的出流峰值', feedback: '对。你区分了过程和总量：调节可以改变出流的时间分布。' },
      { id: 'b', text: '必然消除所有径流体积', feedback: '把削峰当成了消除水量。若水最后仍排出，总量不一定大幅减少。' },
      { id: 'c', text: '容量满了也能持续接纳任意来水', feedback: '忽略了有限容积。储水设施必须考虑溢流和后续排空。' },
    ], correctOption: 'a', hints: ['比较“这一秒排多少”和“整场雨共排多少”。', '调节的重点是改变出流过程，储存的容量有限。', '试想把同时排出的水错开排放：峰值可能变化，总量未必同样变化。'], explanation: '径流总量是整场事件的累计水量，峰值流量是事件中最大的瞬时流量，即单位时间流过的水量。临时储水、控制出流可以削峰和延缓出流，但不等于去除了全部水量。', example: '两个水箱都排出一桶水，一个一分钟倒完，一个十分钟放完；总量一样，出流过程不同。', reflection: '你会用哪个指标判断“排得更慢”，哪个指标判断“总量更少”？' },
    { id: 'garden', nodeNames: ['雨水花园'], title: '把原理放进一个花园', question: '设计雨水花园时，除了种植植物，还必须考虑什么？', options: [
      { id: 'a', text: '只看植物种类，水可以自行找到去路', feedback: '把雨水花园当成了普通花坛。收水、介质和排水结构共同决定作用。' },
      { id: 'b', text: '越深越好，不需要考虑积水时长', feedback: '忽略了植物耐淹、排空时间与场地条件。加深并非在任何情况下都更好。' },
      { id: 'c', text: '来水路径、介质、溢流与维护', feedback: '对。设施要接得到水、处理得了水，也要给超量来水留出安全去路。' },
    ], correctOption: 'c', hints: ['先问：雨水从哪里来，又要到哪里去？', '滞蓄和过滤需要介质，容量满后需要另一条去路。', '把进水、介质处理、溢流、维护连成完整设计检查。'], explanation: '雨水花园利用下凹种植空间及土壤介质收集、滞蓄和处理径流。必须配合汇水关系、排水和溢流设计，不能替代整个城市排水系统。', example: '路边花园若高于路面、没有进水开口，即使植物很好，也可能收不到道路径流。', reflection: '准备去沙盘前，预测增加雨水花园面积会怎样影响总量与峰值，并写出一个限制条件。' },
  ] },
  { id: 'permeable-paving', title: '透水的路，为什么也会积水？', subtitle: '看见面层下面的结构，学会检验设施的边界。', network: 'sponge', minutes: 7, experiment: 'permeable-paving', steps: [
    { id: 'layers', nodeNames: ['透水铺装', '渗透'], title: '不只是一块透水砖', question: '铺上透水面砖后，为什么仍不能直接认定整套铺装透水良好？', options: [
      { id: 'a', text: '还需要看基层、土壤和排水条件', feedback: '对。雨水要穿过一整套结构，不能只判断最上面一层。' },
      { id: 'b', text: '只要砖上有孔就足够', feedback: '把面层性能当成了系统性能。下部结构不透水或堵塞时仍可能积水。' },
      { id: 'c', text: '任何土壤都能无限接纳雨水', feedback: '忽略了土壤渗透性与地下水条件，场地适用性必须核查。' },
    ], correctOption: 'a', hints: ['让一滴水从表面向下走一遍。', '面层下面还有基层和土壤，任何一层都可能限制流动。', '同时检查入渗通道与排水出路，才能判断系统表现。'], explanation: '透水铺装通过面层和基层孔隙让部分雨水下渗、储存或排出。其表现是整套结构和场地条件共同作用的结果。', example: '面砖透水，但下部土壤已饱和时，水可能暂存于基层，或通过设计的排水结构排出。', reflection: '如果面层透水但下部不透水，你会继续查哪两项条件？' },
    { id: 'maintenance', nodeNames: ['透水铺装'], title: '把时间放进设计', question: '道路使用一段时间后透水效果下降，哪项检查最有针对性？', options: [
      { id: 'a', text: '确认砖的颜色是否褪色', feedback: '颜色变化不是判断透水通道的主要依据。应该检查孔隙和维护状态。' },
      { id: 'b', text: '检查泥沙堵塞和清理维护', feedback: '对。堵塞会影响孔隙和排水能力，长期表现离不开维护。' },
      { id: 'c', text: '面积没有变，所以效果一定没有变', feedback: '把几何面积等同于有效能力。堵塞可能使同样面积的效果下降。' },
    ], correctOption: 'b', hints: ['想想泥沙会在雨水经过的地方留下什么。', '孔隙是通道，通道被堵后会怎样？', '长期运行要检查堵塞和维护，不只看名义面积。'], explanation: '维护是透水铺装性能的一部分。泥沙堵塞、结构损坏和排水受阻都会改变效果，不能把初期性能直接等同于长期性能。', example: '施工泥浆进入铺装孔隙后，即使面积不变，也可能比清洁时更容易积水。', reflection: '写一个“面积相同，但效果不同”的原因。' },
    { id: 'comparison', nodeNames: ['透水铺装', '调节'], title: '做一次公平的比较', question: '要研究增加透水铺装面积的影响，哪组实验最容易解释？', options: [
      { id: 'a', text: '同时换降雨、面积、深度和设施类型', feedback: '同时改变多个条件，很难判断哪项变化造成了结果差异。' },
      { id: 'b', text: '只看有没有积水，不看其他指标', feedback: '洪泛、径流总量和峰值反映不同方面；只看一个现象可能遗漏信息。' },
      { id: 'c', text: '保持降雨和其他设置相同，只改变面积', feedback: '对。控制其他条件后，再对照径流总量和峰值，结论更有依据。' },
    ], correctOption: 'c', hints: ['先决定你想检验的是哪一个变量。', '比较实验时，应尽量保持其他条件一致。', '这次只改面积，同时记录降雨、深度和结果指标。'], explanation: '在同样降雨与模型条件下改变一个设计变量，可以更清楚地观察该变量的影响。仿真结论仍受模型和场地假设限制。', example: '用相同 5 年一遇降雨，比较 50 m² 与 100 m² 透水铺装，深度和其余设施保持一致。', reflection: '写下本次实验改变的变量，以及至少两个保持不变的条件。' },
  ] },
  { id: 'drainage-systems', title: '雨水和污水，要不要一起走？', subtitle: '比较分流与合流，避免用一个标签判断工程。', network: 'drainage', minutes: 6, steps: [
    { id: 'separate', nodeNames: ['分流制', '合流制'], title: '先看两种水的路', question: '判断分流制与合流制时，最关键的区别是什么？', options: [
      { id: 'a', text: '雨水和污水是否由不同管渠系统收集输送', feedback: '对。先辨认收集输送系统，再讨论处理和排放。' },
      { id: 'b', text: '所有管道的管径是否相同', feedback: '管径不是体制的定义。不同体制都需要按服务范围和流量确定管径。' },
      { id: 'c', text: '城市里是否有污水处理厂', feedback: '有无处理厂不能直接区分体制；截流式合流系统也可以将污水送去处理。' },
    ], correctOption: 'a', hints: ['抓住“分”和“合”对应的对象。', '比较雨水与生活、生产污水使用的管渠。', '核心是是否分别收集输送，而不是只看管径或处理厂。'], explanation: '分流制用不同系统输送雨水与污水；合流制用同一套管渠收集输送。体制名称不直接等于污染控制效果。', example: '同一街道下可以分别设置雨水管与污水管，两套系统各有相应的去向。', reflection: '用自己的话说明，分流制“分”的是什么。' },
    { id: 'overflow', nodeNames: ['合流制', '体制选择'], title: '晴天能处理，下雨呢？', question: '截流式合流系统在旱天可以送水处理，强降雨时为什么仍可能产生污染风险？', options: [
      { id: 'a', text: '雨水会让污水中的污染物全部消失', feedback: '稀释不等于去除污染负荷，不能据此认为风险消失。' },
      { id: 'b', text: '混合来水超过截流、调蓄或处理能力，可能溢流', feedback: '对。容量和来水过程共同决定是否溢流，需要综合治理。' },
      { id: 'c', text: '合流系统任何时候都不送去处理', feedback: '忽略了截流式合流制的旱天运行方式，应区分不同运行工况。' },
    ], correctOption: 'b', hints: ['把强降雨带来的额外流量算进去。', '截流、调蓄与处理都有容量上限。', '当混合来水超过系统能力，想想超出部分的去向。'], explanation: '截流式合流系统在旱天可以将污水送去处理，降雨时超出系统能力的混合水可能溢流。控制需要结合截流、调蓄、处理和溢流治理。', example: '同一片老城区在晴天与暴雨期间，管网来水量和运行状态可能明显不同。', reflection: '为什么“有污水处理厂”并不等于“暴雨时没有污染风险”？' },
    { id: 'decision', nodeNames: ['分流制', '混合制', '体制选择'], title: '选择，需要什么证据？', question: '老城区排水改造，哪种判断更合理？', options: [
      { id: 'a', text: '只要改成分流，就不必检查混接和初期径流', feedback: '体制改变并不会自动消除混接和雨水污染，需要检查实际运行。' },
      { id: 'b', text: '所有城市所有区域都必须采用同一种方案', feedback: '忽略了现状、用地、施工条件和分区差异，混合体制也可能需要统筹。' },
      { id: 'c', text: '结合现状管网、混接、用地、施工和受纳水体综合判断', feedback: '对。用工程条件支持选择，而不是把体制名称当成最终结论。' },
    ], correctOption: 'c', hints: ['想想老城有哪些条件不能轻易改变。', '把现状、施工条件与环境目标一起考虑。', '即使选择分流，也要核查混接和径流污染。'], explanation: '排水体制选择要结合现状和建设条件。分流制仍需处理混接、初期径流污染等问题，改造方案应有明确的分区边界和衔接。', example: '老城区治理合流溢流，新城区建设分流系统，两者需要在全市层面协调。', reflection: '为老城区改造列出三项应先调查的证据。' },
  ] },
  { id: 'water-treatment', title: '水看起来清了，就能喝吗？', subtitle: '沿净水流程追问：每一步究竟解决了什么。', network: 'water', minutes: 7, steps: [
    { id: 'coagulation', nodeNames: ['混凝', '沉淀'], title: '让小颗粒先聚在一起', question: '常规地表水处理中，为什么经常先混凝、再沉淀？', options: [
      { id: 'a', text: '混凝先让细小颗粒形成较易分离的絮体', feedback: '对。前一步为重力分离创造条件，各步骤承担不同任务。' },
      { id: 'b', text: '混凝的作用就是灭活所有病原微生物', feedback: '把混凝与消毒混淆了。混凝的主要目的在于促使胶体和细颗粒聚集。' },
      { id: 'c', text: '沉淀主要依靠水蒸发来分离颗粒', feedback: '沉淀利用的是重力分离，不是蒸发。' },
    ], correctOption: 'a', hints: ['想想很小的胶体和较大絮体，哪一种更容易分离。', '混凝改变颗粒聚集状态，沉淀利用重力。', '前一步形成絮体，为后一步分离创造条件。'], explanation: '混凝使难以自行沉降的胶体、细小颗粒形成絮体，沉淀再利用重力分离可沉降颗粒。工艺效果依赖水质、药剂和水力条件。', example: '适当混合后形成的絮体可以在沉淀设施中下沉，沉泥还需要及时排出。', reflection: '用一句话解释混凝为什么能帮助后续沉淀。' },
    { id: 'filter', nodeNames: ['过滤', '沉淀'], title: '为什么还要再过滤？', question: '沉淀后还安排过滤，主要是为了什么？', options: [
      { id: 'a', text: '只把水温降下来', feedback: '这不是常规过滤的主要任务。这里应关注沉淀后残留的细颗粒。' },
      { id: 'b', text: '通过滤料进一步截留细小颗粒', feedback: '对。过滤补充颗粒去除，但不能取代所有后续处理。' },
      { id: 'c', text: '只要过滤，所有溶解污染物也一定被去除', feedback: '扩大了过滤的作用范围。常规滤料并不保证去除所有溶解性污染物。' },
    ], correctOption: 'b', hints: ['沉淀主要分离可沉降颗粒，仍可能留下什么？', '想想水穿过滤料时，哪些物质会被截留。', '关注细小颗粒，同时保留对溶解物和微生物风险的区分。'], explanation: '常规过滤让水通过滤料，进一步去除部分细小颗粒。滤料、滤速、反冲洗和进水水质共同影响表现。', example: '滤池运行后会积累截留物，需要适当反冲洗和维护，不能永远不管理。', reflection: '为什么“多一道过滤”与“去除所有污染物”不是同一个判断？' },
    { id: 'disinfect', nodeNames: ['消毒', '过滤'], title: '清澈不是最后的证据', question: '水已清澈，为什么通常仍需要消毒与水质检验？', options: [
      { id: 'a', text: '看不到杂质，就不会有任何卫生风险', feedback: '把肉眼观察当成了完整水质证据。病原微生物风险不能靠看起来清澈判断。' },
      { id: 'b', text: '消毒可以替代混凝、沉淀和过滤', feedback: '把不同工艺的功能混为一谈。消毒不能替代前面的颗粒去除。' },
      { id: 'c', text: '需要控制微生物风险，并检验是否满足相应水质要求', feedback: '对。清澈是一种外观，安全需要工艺控制和检验支持。' },
    ], correctOption: 'c', hints: ['哪些风险不能被肉眼看见？', '消毒的主要目标是病原微生物。', '外观与水质标准是两个层面的证据，不能只凭一个判断。'], explanation: '消毒通过化学或物理方法灭活病原微生物。需控制剂量、接触条件、副产物等，最终是否满足要求应以适用标准和检验为依据。', example: '一杯看起来清澈的水，也可能未完成消毒；本练习不构成任何具体水源可饮用的判断。', reflection: '把混凝、沉淀、过滤、消毒各自的任务，用四个短句写出来。' },
  ] },
];

export const findLesson = (id: string | null | undefined) => MENTOR_LESSONS.find(lesson => lesson.id === id);
// Explicit synonyms only. Descriptions, keywords and partial names must not turn
// a lesson's teaching sequence into a claim about an unrelated graph node.
const NODE_NAME_ALIASES = [
  ['渗透', '下渗', '入渗'],
  ['储存', '雨水储存'],
] as const;
export function resolveStepNodes(step: LessonStep, graph: KnowledgeGraph, network: string): KnowledgeNode[] {
  const result: KnowledgeNode[] = [];
  const seen = new Set<string>();
  for (const name of step.nodeNames) {
    const aliases: readonly string[] = NODE_NAME_ALIASES.find(group => group.some(alias => alias === name)) || [name];
    const candidates = graph.nodes.filter(node => aliases.includes(node.name));
    const local = candidates.filter(node => node.id.startsWith(network + ':'));
    const scope = local.length ? local : candidates;
    const node = scope.find(item => item.name === name) || scope[0];
    if (node && !seen.has(node.id)) {
      seen.add(node.id);
      result.push(node);
    }
  }
  return result;
}
export function gradeStep(step: LessonStep, optionId: string) {
  const option = step.options.find(item => item.id === optionId);
  return option ? {correct: option.id === step.correctOption, feedback: option.feedback} : null;
}
export type StepAttempt = {choice: string | null; attempts: number; hintLevel: number; revealed: boolean; reviewedAfterAnswer: boolean; correct: boolean; assisted: boolean};
export type StepProgress = StepAttempt & {note: string; history: StepAttempt[]};
export type MentorSession = {version: 1; lessonId: string | null; stepIndex: number; mode: MentorMode; progress: Record<string, StepProgress>};
export const blankStepProgress = (): StepProgress => ({choice:null, attempts:0, hintLevel:0, revealed:false, reviewedAfterAnswer:false, correct:false, assisted:false, note:'', history:[]});
export const emptyMentorSession = (): MentorSession => ({version:1, lessonId:null, stepIndex:0, mode:'guided', progress:{}});
export const progressKey = (lesson: MentorLesson, step: LessonStep) => `${lesson.id}:${step.id}`;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const record = (v: unknown): Record<string, unknown> => isRecord(v) ? v : {};
const bounded = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;
function restoreStepAttempt(step: LessonStep, raw: Record<string, unknown>): StepAttempt {
  const attempts = bounded(raw.attempts, 999);
  const hintLevel = bounded(raw.hintLevel, 3);
  const revealed = raw.revealed === true;
  const choice = attempts > 0 && typeof raw.choice === 'string' && gradeStep(step, raw.choice) ? raw.choice : null;
  const correct = choice === step.correctOption;
  const reviewedAfterAnswer = raw.reviewedAfterAnswer === true && correct && attempts === 1;
  return {choice, attempts, hintLevel, revealed, reviewedAfterAnswer, correct,
    assisted:raw.assisted === true || hintLevel > 0 || (revealed && !reviewedAfterAnswer) || attempts > 1};
}
const hasAttemptActivity = (attempt: StepAttempt) => attempt.attempts > 0 || attempt.hintLevel > 0 || attempt.revealed || attempt.assisted;
function restoreStepHistory(step: LessonStep, value: unknown): StepAttempt[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map(raw => restoreStepAttempt(step, raw)).filter(hasAttemptActivity).slice(-5);
}
export function restoreMentorSession(value: unknown): MentorSession {
  const saved = record(value), session = emptyMentorSession();
  if (saved.version !== 1) return session;
  const lesson = typeof saved.lessonId === 'string' ? findLesson(saved.lessonId) : undefined;
  session.lessonId = lesson?.id || null;
  session.stepIndex = lesson ? bounded(saved.stepIndex, lesson.steps.length - 1) : 0;
  if (saved.mode === 'quiz' || saved.mode === 'explore') session.mode = saved.mode;
  const progress = record(saved.progress);
  for (const course of MENTOR_LESSONS) for (const step of course.steps) {
    const key = progressKey(course, step);
    if (!Object.prototype.hasOwnProperty.call(progress, key) || !isRecord(progress[key])) continue;
    const raw = progress[key];
    session.progress[key] = {...restoreStepAttempt(step, raw),
      note:typeof raw.note === 'string' ? raw.note.slice(0, 2000) : '',
      history:restoreStepHistory(step, raw.history)};
  }
  return session;
}

export function answerStep(step: LessonStep, previous: StepProgress, choice: string): StepProgress {
  const grade = gradeStep(step, choice);
  if (!grade) return previous;
  return {...previous, choice, correct:grade.correct, attempts:previous.attempts+1,
    assisted:previous.assisted || previous.hintLevel > 0 || previous.revealed || previous.attempts > 0};
}
/** Start a fresh challenge while retaining reflections and recent answer evidence. */
export function restartStep(step: LessonStep, previous: StepProgress): StepProgress {
  const current = restoreStepAttempt(step, previous);
  const history = restoreStepHistory(step, previous.history);
  if (hasAttemptActivity(current)) history.push(current);
  return {...blankStepProgress(), note:previous.note, history:history.slice(-5)};
}
export function accountStorageKey(prefix: string): string | null {
  try {
    const user = JSON.parse(localStorage.getItem('aicourse-user') || 'null');
    const account = user?.email || user?.id;
    return typeof account === 'string' || typeof account === 'number' ? `${prefix}:${encodeURIComponent(String(account))}` : null;
  } catch { return null; }
}
