import { Reference } from '@/types';

// Simulated knowledge base documents
export interface KnowledgeDocument {
  id: string;
  name: string;
  type: string;
  chapters: KnowledgeChapter[];
}

export interface KnowledgeChapter {
  title: string;
  pages: KnowledgePage[];
}

export interface KnowledgePage {
  page: number;
  content: string;
}

export const knowledgeDocuments: KnowledgeDocument[] = [
  {
    id: 'doc-1',
    name: '城市排水系统工程.pdf',
    type: '教材',
    chapters: [
      {
        title: '第一章 城市排水系统概述',
        pages: [
          { page: 1, content: '城市排水系统是城市基础设施的重要组成部分，主要包括雨水管网、污水管网和合流制管网三种类型。' },
          { page: 2, content: '雨水管网设计标准通常以重现期表示，我国一般地区设计重现期为1-3年，重要地区可达5-10年。' },
          { page: 3, content: '排水管网的排水能力取决于管径、坡度、粗糙系数等参数，通过曼宁公式可计算管道流量。' },
          { page: 5, content: '近年来，随着城市化进程加快，不透水面积比例显著增加，从原来的30%上升到70%以上，导致径流系数大幅提高。' },
        ],
      },
      {
        title: '第二章 内涝成因分析',
        pages: [
          { page: 12, content: '城市内涝的主要成因包括：1）极端降雨事件频发；2）排水系统设计标准偏低；3）城市不透水面积增加；4）排水设施老化；5）河道被侵占。' },
          { page: 14, content: '根据住建部调查数据，全国约62%的城市曾发生过不同程度的城市内涝灾害，其中严重内涝事件占比约15%。' },
          { page: 16, content: '海绵城市建设是解决城市内涝问题的重要途径，通过"渗、滞、蓄、净、用、排"六字方针实现雨水的自然积存、自然渗透和自然净化。' },
          { page: 18, content: 'LID（低影响开发）设施包括：雨水花园、下沉式绿地、透水铺装、绿色屋顶等，可有效削减径流峰值30%-50%。' },
        ],
      },
      {
        title: '第三章 排水管网设计',
        pages: [
          { page: 25, content: '排水管网设计的主要参数包括：设计重现期P、径流系数ψ、地面集水时间t₁、管内流行时间t₂。' },
          { page: 28, content: '暴雨强度公式：q = 167A₁(1+ClgP)/(t+b)^n，其中A₁、C、b、n为地方参数，不同城市取值不同。' },
          { page: 32, content: '管段设计流量计算采用推理公式法：Q = ψ·q·F，其中Q为设计流量(L/s)，ψ为径流系数，q为暴雨强度(L/s·ha)，F为汇水面积(ha)。' },
        ],
      },
    ],
  },
  {
    id: 'doc-2',
    name: '海绵城市案例集.pdf',
    type: '案例',
    chapters: [
      {
        title: '案例一：深圳光明新区海绵城市建设',
        pages: [
          { page: 2, content: '深圳光明新区是全国首批海绵城市试点区域，总面积约150平方公里，其中建成区面积约60平方公里。项目总投资约85亿元，建设周期5年（2016-2020）。' },
          { page: 5, content: '通过改造后，光明新区的年径流总量控制率达到70%，雨水资源利用率从不足5%提升至15%，内涝防治标准从1年一遇提升至50年一遇。' },
          { page: 8, content: '主要技术措施包括：建成下沉式绿地面积约120万平方米，透水铺装面积约80万平方米，建设雨水花园约200处，改造绿色屋顶约30万平方米。' },
        ],
      },
      {
        title: '案例二：武汉海绵城市试点',
        pages: [
          { page: 15, content: '武汉市于2015年入选国家首批海绵城市试点，重点改造区域包括青山示范区（23平方公里）和汉阳四新示范区（15平方公里）。' },
          { page: 18, content: '武汉海绵城市项目重点解决内涝问题，通过构建"源头削减-中途转输-末端调蓄"的完整技术体系，试点区内涝风险降低了约60%。' },
        ],
      },
    ],
  },
  {
    id: 'doc-3',
    name: '城市内涝防治技术指南.pdf',
    type: '文献',
    chapters: [
      {
        title: '内涝风险评估方法',
        pages: [
          { page: 5, content: '城市内涝风险评估通常采用三种方法：历史灾情统计法、指标体系评估法和情景模拟法。其中情景模拟法最为准确，需要借助SWMM、MIKE URBAN等水力模型。' },
          { page: 8, content: 'SWMM（暴雨洪水管理模型）是美国环保署（EPA）开发的开源水力模型，可模拟城市雨水管网中的水量和水质变化过程，广泛用于城市排水系统设计和评估。' },
          { page: 12, content: '基于GIS的内涝风险图制作流程包括：地形数据处理、管网数据导入、降雨情景设定、水力模拟计算、结果可视化五个步骤。' },
        ],
      },
      {
        title: '防治措施',
        pages: [
          { page: 22, content: '城市内涝防治体系分为工程措施和非工程措施两大类。工程措施包括管网改造、调蓄设施建设、河道整治等；非工程措施包括预警系统、应急预案、土地利用管理等。' },
          { page: 25, content: '大排水系统（Major Drainage System）概念是指在常规排水系统超载时，利用道路、广场、绿地等地表通道疏导超标雨水，实现城市韧性排水。' },
        ],
      },
    ],
  },
];

// Keyword-based search simulation
export function searchKnowledge(query: string): { content: string; references: Reference[] } {
  const lowerQuery = query.toLowerCase();
  const references: Reference[] = [];
  const contentParts: string[] = [];

  const keywords = extractKeywords(lowerQuery);

  for (const doc of knowledgeDocuments) {
    for (const chapter of doc.chapters) {
      for (const page of chapter.pages) {
        const lowerContent = page.content.toLowerCase();
        const matchCount = keywords.filter(kw => lowerContent.includes(kw)).length;

        if (matchCount > 0) {
          references.push({
            id: references.length + 1,
            docName: doc.name,
            chapter: chapter.title,
            page: page.page,
            snippet: page.content,
          });
          contentParts.push(page.content);
        }
      }
    }
  }

  // Sort references by relevance (match count)
  references.sort((a, b) => {
    const aMatch = keywords.filter(kw => a.snippet.toLowerCase().includes(kw)).length;
    const bMatch = keywords.filter(kw => b.snippet.toLowerCase().includes(kw)).length;
    return bMatch - aMatch;
  });

  // Deduplicate and limit
  const uniqueRefs = references.slice(0, 8);
  const combinedContent = [...new Set(contentParts)].slice(0, 5).join('\n\n');

  return {
    content: combinedContent || '未找到相关内容，请尝试其他关键词。',
    references: uniqueRefs,
  };
}

function extractKeywords(query: string): string[] {
  const keywordMap: Record<string, string[]> = {
    '内涝': ['内涝', '积水', '淹没', '洪涝'],
    '排水': ['排水', '管网', '管道', '雨水'],
    '海绵城市': ['海绵城市', '透水', '下沉式', '雨水花园', '绿色屋顶'],
    'swmm': ['swmm', '模型', '模拟', '水力'],
    '暴雨': ['暴雨', '降雨', '重现期', '强度'],
    '径流': ['径流', '径流系数', '不透水'],
    '设计': ['设计', '标准', '参数'],
    'lid': ['lid', '低影响', '源头'],
  };

  const matched: string[] = [];
  for (const [key, terms] of Object.entries(keywordMap)) {
    if (terms.some(t => query.includes(t))) {
      matched.push(...terms);
    }
  }

  return matched.length > 0 ? matched : query.split(/\s+/).filter(w => w.length > 0);
}
