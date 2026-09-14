import type { KnowledgeNode } from "@/types";

export type ConceptContent = {
  definition: string;
  example: string;
  misconception: string;
  condition: string;
};
export const CONCEPTS: Record<string, ConceptContent> = {
  分流制: {
    definition: "雨水和生活、生产污水分别由不同管渠系统收集输送。",
    example:
      "生活污水送往污水处理厂，雨水通过雨水系统收集，并按当地要求处理或排放。",
    misconception:
      "分流不等于雨水可以未经任何控制直接排放；初期径流污染和混接仍需治理。",
    condition: "新建地区便于统筹建设；既有区域改造要核查混接、用地和施工条件。",
  },
  合流制: {
    definition: "雨水与污水由同一套管渠系统收集输送。",
    example:
      "截流式合流制在旱天将污水送去处理，降雨时超过系统能力的混合水可能溢流。",
    misconception:
      "合流制不等于任何时候都直接排放，也不能仅凭管道数量判断环境效果。",
    condition: "既有城区常见；应结合截流、调蓄、处理能力和溢流控制综合治理。",
  },
  混合制: {
    definition: "同一城市不同区域采用不同排水体制，形成合流与分流并存的系统。",
    example: "老城区保留并改造合流系统，新城区建设分流系统。",
    misconception: "混合制并不是让雨污水随意混接，分区边界和衔接必须清楚。",
    condition: "适合结合现状分区治理，需协调各区域受纳水体和处理能力。",
  },
  混凝: {
    definition:
      "通过投加混凝剂和适当混合，使水中难以自行沉降的胶体、细小颗粒形成絮体。",
    example: "细小颗粒聚成较大的絮体，为后续沉淀和过滤创造条件。",
    misconception: "混凝不是消毒，也不等于单靠搅拌去除所有溶解性污染物。",
    condition: "药剂和运行条件需根据原水水质及试验确定。",
  },
  沉淀: {
    definition: "利用重力使可沉降颗粒与水分离。",
    example: "混凝形成的较大絮体在沉淀设施中下沉，随后排出沉泥。",
    misconception: "沉淀不能代替过滤和消毒，也不能充分去除所有溶解物。",
    condition: "效果与颗粒特性、水力条件、停留时间和排泥管理有关。",
  },
  过滤: {
    definition: "使水通过滤料等介质，截留并去除部分细小颗粒。",
    example: "常规净水处理中，沉淀后的水进入滤池，进一步降低浑浊度。",
    misconception: "水看起来清澈不代表已经完成消毒、符合所有水质要求。",
    condition: "滤料、滤速、反冲洗和进水水质共同影响效果。",
  },
  消毒: {
    definition: "采用化学或物理方法灭活病原微生物，降低卫生风险。",
    example: "根据水质和工艺要求使用氯、臭氧或紫外线等方法。",
    misconception: "消毒不是去除所有污染物，也不能替代前面的颗粒去除过程。",
    condition: "需控制剂量、接触条件和副产物，并满足相应水质要求。",
  },
  环状管网: {
    definition: "管道相互连接成环，使部分节点具备多个可能的供水路径。",
    example: "某段管道检修时，可通过阀门调度利用另一方向供水。",
    misconception: "有替代路径不等于任何故障下都能保证水量水压。",
    condition: "通常可靠性较高；仍需校核水力、阀门分区和投资条件。",
  },
  枝状管网: {
    definition: "管道从干管向支管分支，整体呈树状。",
    example: "单一支管承担某个末端区域的供水。",
    misconception: "枝状管网并非一律不能使用，应结合规模和供水可靠性要求选择。",
    condition: "结构较简单，但上游故障可能影响下游，末端水质管理也需关注。",
  },
  地表水: {
    definition: "河流、湖泊、水库等地表水体中的水，是城市供水的重要来源。",
    example: "水库作为原水水源，经取水、处理后进入供水系统。",
    misconception: "水量大并不等于可无条件利用，还需考虑水质、生态和调度。",
    condition: "受季节变化、流域污染和水资源配置条件影响。",
  },
  地下水: {
    definition: "储存在地表以下含水层中的水。",
    example: "经评价和许可后，通过水井开采地下水用于供水。",
    misconception: "地下水并非天然适合直接饮用，也不能无限制开采。",
    condition: "需评价补给、水质、可持续开采量及地面沉降等影响。",
  },
  透水铺装: {
    definition: "通过面层及基层的孔隙让部分雨水下渗、储存或排出。",
    example: "适宜场地的人行道采用透水结构，减少部分地表径流。",
    misconception:
      "透水面层不代表整套结构一直高效透水，基层、土壤和堵塞都影响表现。",
    condition: "需核查土壤、地下水、荷载条件和维护能力。",
  },
  雨水花园: {
    definition:
      "利用下凹种植空间、土壤介质及必要的排水结构，收集并处理雨水径流。",
    example: "将屋面或道路部分径流导入种植区，经历滞蓄、过滤、入渗或排出。",
    misconception: "雨水花园不能代替城市排水系统，超量来水仍需安全溢流通道。",
    condition: "需要合适的汇水关系、植物、介质、溢流与维护设计。",
  },
  绿色屋顶: {
    definition:
      "在屋面设置适宜的种植层和排水、防水等构造，发挥雨水滞留等作用。",
    example: "降雨先被植被和基质截留，部分蒸散，剩余水量通过屋面排水排出。",
    misconception: "绿色屋顶不能消除所有屋面径流，也不能忽略结构承载和防水。",
    condition: "需核查承载、防水、植物与养护条件。",
  },
  下凹绿地: {
    definition: "标高低于周边汇水面的绿地，可接纳并短时滞留径流。",
    example: "道路边的适宜绿地通过开口接纳部分雨水。",
    misconception: "只把绿地下挖不等于完成设计，进水、溢流和积水时长都需控制。",
    condition: "应结合土壤、植物耐淹性、地下设施和排空条件。",
  },
  渗透: {
    definition: "水从地表进入土壤孔隙的过程。",
    example: "在适宜条件下，绿地将部分雨水导入土壤。",
    misconception: "下渗能力受土壤和含水状态限制，不能假定所有雨水都会下渗。",
    condition: "需关注土壤渗透性、地下水位及污染风险。",
  },
  储存: {
    definition: "将一定水量暂时保留，供后续利用或有序排放。",
    example: "储水设施收集屋面雨水，在处理后用于适宜用途。",
    misconception: "储存容量有限，设施满后仍需要安全的溢流或排水路径。",
    condition: "需匹配来水、需求、调度和维护。",
  },
  调节: {
    definition: "通过临时储水与控制出流，调整径流过程。",
    example: "调蓄设施在降雨期间储存部分水量，再按条件缓慢排出。",
    misconception: "削减流量峰值不等于消除了全部径流体积。",
    condition: "效果受可用容积、出流控制和降雨过程影响。",
  },
};

export function conceptContent(node: KnowledgeNode): ConceptContent {
  return (
    CONCEPTS[node.name] || {
      definition:
        node.description ||
        `“${node.name}”位于《${node.chapter}》的知识结构中。可从它解决的问题、适用条件和与相邻概念的联系开始学习。`,
      example:
        "点击“看例子”，结合当前专题获取一个具体情境，再对照课程资料理解。",
      misconception:
        "先区分概念的定义、适用条件和局限；不能仅凭章节连线推断因果关系。",
      condition: "结合所属章节、工程条件及现行适用规范进行判断。",
    }
  );
}

export type ProcessStep = { name: string; what: string; note: string };
export const WATER_STEPS: ProcessStep[] = [
  {
    name: "混凝",
    what: "让细小颗粒聚集成絮体",
    note: "先创造更容易被后续分离的颗粒条件。",
  },
  {
    name: "沉淀",
    what: "让可沉降絮体与水分离",
    note: "利用重力分离，及时排泥。",
  },
  {
    name: "过滤",
    what: "进一步去除细小颗粒",
    note: "水通过滤料；滤池需要维护与反冲洗。",
  },
  {
    name: "消毒",
    what: "灭活病原微生物",
    note: "根据工艺控制消毒条件，保障卫生安全。",
  },
];
export const WASTEWATER_STEPS: ProcessStep[] = [
  { name: "格栅", what: "拦截较大的杂物", note: "保护后续水泵和处理设备。" },
  {
    name: "沉砂池",
    what: "分离砂粒等较重颗粒",
    note: "减少后续构筑物磨损和沉积。",
  },
  {
    name: "生物处理",
    what: "利用微生物转化污染物",
    note: "典型活性污泥工艺需要适宜的运行条件。",
  },
  {
    name: "二沉池",
    what: "分离泥水",
    note: "部分污泥回流；本图省略回流等支路。",
  },
  {
    name: "消毒",
    what: "按出水要求降低卫生风险",
    note: "具体工程还可能设置深度处理。",
  },
];

export type Practice = {
  id: string;
  type: "order" | "connect" | "classify";
  title: string;
  prompt: string;
  items: string[];
  targets?: string[];
  solution: string[];
  hints: string[];
  explanation: string;
  nodeNames: string[];
};
export const PRACTICES: Practice[] = [
  {
    id: "water-order",
    type: "order",
    title: "拼出常规净水流程",
    prompt: "本题采用常规地表水处理主线。将四个步骤排成合理顺序。",
    items: ["消毒", "沉淀", "混凝", "过滤"],
    solution: ["混凝", "沉淀", "过滤", "消毒"],
    hints: [
      "先让细颗粒聚集，再利用重力分离。",
      "过滤处理剩余细颗粒，消毒承担微生物控制。",
    ],
    explanation:
      "这条常规主线是混凝 → 沉淀 → 过滤 → 消毒。实际工艺会随原水水质和处理目标调整。",
    nodeNames: ["混凝", "沉淀", "过滤", "消毒"],
  },
  {
    id: "water-connect",
    type: "connect",
    title: "连接方法与作用",
    prompt: "先选择左侧处理方法，再选择它最直接的作用。",
    items: ["混凝", "沉淀", "过滤", "消毒"],
    targets: [
      "灭活病原微生物",
      "利用重力分离絮体",
      "使细颗粒形成絮体",
      "截留剩余细颗粒",
    ],
    solution: [
      "使细颗粒形成絮体",
      "利用重力分离絮体",
      "截留剩余细颗粒",
      "灭活病原微生物",
    ],
    hints: [
      "“混凝”着重形成絮体，不是最终完成分离。",
      "区分颗粒控制与病原微生物控制。",
    ],
    explanation: "四个环节各有主要任务，前一环节通常为后一环节创造条件。",
    nodeNames: ["混凝", "沉淀", "过滤", "消毒"],
  },
  {
    id: "drainage-classify",
    type: "classify",
    title: "辨认排水体制",
    prompt: "将下列系统描述放入对应类别。点击类别也可以完成分类。",
    items: [
      "雨水与污水分别走两套管渠",
      "雨污水共用一套收集管渠",
      "老城区合流、新城区分流",
    ],
    targets: ["分流制", "合流制", "混合制"],
    solution: ["分流制", "合流制", "混合制"],
    hints: [
      "先看同一区域的雨污水是否共用管渠。",
      "整座城市可以分区采用不同体制。",
    ],
    explanation:
      "体制描述的是收集输送结构；选择时还需考虑污染控制、现状条件及改造成本。",
    nodeNames: ["分流制", "合流制", "混合制"],
  },
];
export function gradePractice(practice: Practice, answer: string[]) {
  const wrong = practice.solution
    .map((value, index) => (value === answer[index] ? -1 : index))
    .filter((index) => index >= 0);
  return {
    correct: wrong.length === 0,
    wrong,
    complete:
      answer.length === practice.solution.length && answer.every(Boolean),
  };
}

/** Qualitative connectivity only; no hydraulic calculations or sandbox dependencies. */
export function reachableNodes(
  edges: [string, string][],
  disabledEdge: number | null,
  root: string,
) {
  const reached = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    edges.forEach(([a, b], i) => {
      if (i === disabledEdge) return;
      if (reached.has(a) && !reached.has(b)) {
        reached.add(b);
        changed = true;
      }
      if (reached.has(b) && !reached.has(a)) {
        reached.add(a);
        changed = true;
      }
    });
  }
  return reached;
}
