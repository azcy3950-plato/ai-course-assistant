/**
 * 将知识库所有文档分段、向量化、存入 Supabase
 * 运行: npx tsx scripts/seed-vectors.ts
 */

const API = process.env.SEED_API_URL || "http://localhost:3000/api/agent";
const SEED_TOKEN = process.env.SEED_API_TOKEN;

// 知识库数据（来自 src/data/knowledge-base.ts）
const documents = [
  {
    name: "城市排水系统工程.pdf",
    chapters: [
      {
        title: "第一章 城市排水系统概述",
        pages: [
          "城市排水系统是城市基础设施的重要组成部分，主要包括雨水管网、污水管网和合流制管网三种类型。",
          "雨水管网设计标准通常以重现期表示，我国一般地区设计重现期为1-3年，重要地区可达5-10年。",
          "排水管网的排水能力取决于管径、坡度、粗糙系数等参数，通过曼宁公式可计算管道流量。",
          "近年来，随着城市化进程加快，不透水面积比例显著增加，从原来的30%上升到70%以上，导致径流系数大幅提高。",
        ],
      },
      {
        title: "第二章 内涝成因分析",
        pages: [
          "城市内涝的主要成因包括：1）极端降雨事件频发；2）排水系统设计标准偏低；3）城市不透水面积增加；4）排水设施老化；5）河道被侵占。",
          "根据住建部调查数据，全国约62%的城市曾发生过不同程度的城市内涝灾害，其中严重内涝事件占比约15%。",
          "海绵城市建设是解决城市内涝问题的重要途径，通过渗、滞、蓄、净、用、排六字方针实现雨水的自然积存、自然渗透和自然净化。",
          "LID（低影响开发）设施包括：雨水花园、下沉式绿地、透水铺装、绿色屋顶等，可有效削减径流峰值30%-50%。",
        ],
      },
      {
        title: "第三章 排水管网设计",
        pages: [
          "排水管网设计的主要参数包括：设计重现期P、径流系数ψ、地面集水时间t₁、管内流行时间t₂。",
          "暴雨强度公式：q = 167A₁(1+ClgP)/(t+b)^n，其中A₁、C、b、n为地方参数，不同城市取值不同。",
          "管段设计流量计算采用推理公式法：Q = ψ·q·F，其中Q为设计流量(L/s)，ψ为径流系数，q为暴雨强度(L/s·ha)，F为汇水面积(ha)。",
        ],
      },
    ],
  },
  {
    name: "海绵城市案例集.pdf",
    chapters: [
      {
        title: "第一章 海绵城市理念",
        pages: [
          "海绵城市是指城市能够像海绵一样，在适应环境变化和应对自然灾害等方面具有良好的弹性，下雨时吸水、蓄水、渗水、净水，需要时将蓄存的水释放并加以利用。",
          "海绵城市六大核心技术：渗（下渗）、滞（滞留）、蓄（调蓄）、净（净化）、用（回用）、排（排放），形成完整的雨水管理链条。",
          "《海绵城市建设技术指南》明确了海绵城市建设目标：年径流总量控制率不低于70%，对应设计降雨量24.5mm。",
          "海绵城市与LID（低影响开发）、WSUD（水敏感城市设计）、GI（绿色基础设施）等国际理念一脉相承但有所创新。",
        ],
      },
      {
        title: "第二章 典型案例",
        pages: [
          "深圳光明新区海绵城市建设示范区，总面积约10平方公里，采用透水铺装、雨水花园、绿色屋顶等多种措施。",
          "武汉青山示范区：针对老城区排水能力不足的问题，通过海绵改造提升了区域排水标准从1年一遇到3年一遇。",
          "济南海绵城市建设重点解决了泉水保护与城市排涝的矛盾，通过源头减排、过程控制、系统治理的综合措施。",
          "国外案例：美国费城绿色城市清洁水计划，通过绿色基础设施减少合流制溢流污染，总投资约24亿美元，为期25年。",
        ],
      },
    ],
  },
  {
    name: "城市内涝防治技术指南.pdf",
    chapters: [
      {
        title: "第一章 内涝风险评估",
        pages: [
          "城市内涝风险评估采用层次分析法（AHP）或模糊综合评价法，评价指标包括：降雨特征、地形地貌、排水能力、下垫面条件等。",
          "内涝风险等级划分：高风险区（积水深度>0.5m）、中风险区（0.15-0.5m）、低风险区（<0.15m）。",
          "SWMM模型（暴雨洪水管理模型）是美国环保署开发的动态降雨-径流模拟模型，广泛应用于城市排水系统规划和分析。",
          "InfoWorks ICM是城市综合流域排水模型，可模拟降雨-径流、管网水力、河道水力学、水质等一体化过程。",
        ],
      },
      {
        title: "第二章 防治措施",
        pages: [
          "城市内涝防治体系分为工程措施和非工程措施两大类。工程措施包括管网改造、调蓄设施建设、河道整治等。",
          "非工程措施包括：内涝预警系统、应急预案、公众教育、土地利用规划等。",
          "雨水调蓄池是重要的内涝防治设施，包括在线调蓄池和离线调蓄池两种类型，可有效削减洪峰流量。",
          "深隧排水系统（深层隧道）是针对大城市极端暴雨的重大工程措施，典型案例包括芝加哥TARP工程、东京首都圈外围排水系统、广州东濠涌深隧等。",
        ],
      },
      {
        title: "第三章 设计标准",
        pages: [
          "《室外排水设计标准》GB50014-2021规定：大城市中心城区雨水管渠设计重现期为3-5年，特大城市提高至5-10年。",
          "内涝防治设计重现期：特大城市50-100年，大城市30-50年，中等城市20-30年。",
          "雨水管渠设计流量公式中，集水时间t=t₁+mt₂，其中地面集水时间t₁一般取5-15分钟。",
        ],
      },
    ],
  },
];

async function seed() {
  if (!SEED_TOKEN) {
    throw new Error("缺少 SEED_API_TOKEN，拒绝执行会清空向量数据的初始化脚本");
  }
  // First clear existing chunks
  console.log("清空已有向量数据...");
  await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SEED_TOKEN}`,
    },
    body: JSON.stringify({ action: "clear_chunks", params: {} }),
  });

  let total = 0;

  for (const doc of documents) {
    for (const ch of doc.chapters) {
      for (const page of ch.pages) {
        // Skip very short or meta-text entries
        if (page.length < 20) continue;

        console.log(`📝 ${doc.name} / ${ch.title}: ${page.slice(0, 40)}...`);

        const res = await fetch(API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          Authorization: `Bearer ${SEED_TOKEN}`,
          },
          body: JSON.stringify({
            action: "seed_chunk",
            params: {
              docName: doc.name,
              chapter: ch.title,
              content: page,
            },
          }),
        });

        if (res.ok) {
          total++;
          console.log("  ✅");
        } else {
          const err = await res.text();
          console.log(`  ❌ ${err}`);
        }
      }
    }
  }

  console.log(`\n🎉 完成！共向量化 ${total} 条知识片段`);
}

seed().catch(console.error);
