import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const GRAPH = {
  nodes: [
    { id: "intro", label: "课程绪论", keywords: ["绪论", "基础设施", "城市规划", "历史"] },
    { id: "water", label: "给水工程规划", keywords: ["给水", "供水", "水源"] },
    { id: "drain", label: "排水工程规划", keywords: ["排水", "管网", "雨水", "污水", "重现期", "设计流量"] },
    { id: "sponge", label: "海绵城市", keywords: ["海绵", "LID", "透水", "径流", "下渗"] },
    { id: "resil", label: "韧性城市规划", keywords: ["韧性", "防灾", "气候适应"] },
    { id: "green", label: "绿色基础设施", keywords: ["绿色基础设施", "GI", "生态", "可持续"] },
    { id: "swmm", label: "SWMM内涝模型", keywords: ["SWMM", "模拟", "内涝", "耦合", "模型"] },
    { id: "cases", label: "案例研究", keywords: ["北京", "雄安", "马鞍山", "太原", "非洲", "美国", "德国", "案例"] },
    { id: "policy", label: "政策与标准", keywords: ["GB", "标准", "规范", "平急两用", "国土空间"] },
  ],
  edges: [
    { from: "intro", to: "water", rel: "prerequisite" },
    { from: "intro", to: "drain", rel: "prerequisite" },
    { from: "water", to: "drain", rel: "related" },
    { from: "drain", to: "sponge", rel: "leads_to" },
    { from: "drain", to: "swmm", rel: "leads_to" },
    { from: "sponge", to: "green", rel: "related" },
    { from: "sponge", to: "resil", rel: "leads_to" },
    { from: "green", to: "cases", rel: "applied_in" },
    { from: "resil", to: "cases", rel: "applied_in" },
    { from: "swmm", to: "cases", rel: "applied_in" },
    { from: "drain", to: "policy", rel: "governed_by" },
  ],
};

export async function GET(req: NextRequest) {
  try {
    const result = await pool.query("SELECT DISTINCT doc_name FROM document_chunks");
    const topicCounts: Record<string, number> = {};
    for (const r of result.rows) {
      for (const node of GRAPH.nodes) {
        for (const kw of node.keywords) {
          if (r.doc_name.includes(kw)) {
            topicCounts[node.id] = (topicCounts[node.id] || 0) + 1;
            break;
          }
        }
      }
    }
    return NextResponse.json({
      graph: GRAPH,
      topicCounts,
      totalDocs: result.rows.length,
      suggestedPath: ["intro", "water", "drain", "sponge", "swmm", "green", "resil", "cases", "policy"],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
