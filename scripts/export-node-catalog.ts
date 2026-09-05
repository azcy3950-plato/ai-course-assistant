/**
 * 开发期一次性生成器：把内存知识图谱的全部节点导出为 scripts/node-catalog.json。
 * 用途：演示数据 seed 需要用与运行时一致的节点 id 写入 student_node_progress。
 * 运行：npx tsx scripts/export-node-catalog.ts
 * 注意：knowledge-map-data.ts 是图谱核心（只读不改），本脚本只派生目录产物。
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { NETWORK_DEFS } from "../src/lib/knowledge-map-data";

function hashString(input: string): number {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function nodeId(networkId: string, depth: number, sectionIndex: number, itemIndex: number, full: string): string {
  return `${networkId}:${depth}:${sectionIndex}:${itemIndex}:${hashString(full)}`;
}

// 与 knowledge-map-builder.ts inferKind 一致的简化分类（目录里分类只用于展示）
function inferKind(label: string, summary: string, depth: number): string {
  const text = label + summary;
  if (depth === 0) return "core";
  if (depth === 1) return "category";
  if (/案例|试点|平台|实践|经验|建设/.test(text)) return "case";
  if (/标准|指标|率|系数|规范|导则|意见|目标|排放/.test(text)) return "standard";
  if (/背景|概念|理论|定义|历史|作用|分类|框架|导向/.test(text)) return "concept";
  if (/法|技术|工艺|处理|计算|布置|设计|铺装|花园|湿地|沟|泵|管网|过滤|沉淀|消毒|调蓄|排水|给水|取水|净水|污水/.test(text)) return "method";
  return "detail";
}

interface CatalogEntry {
  id: string;
  name: string;
  chapter: string;
  category: string;
  net: string;
}

const catalog: CatalogEntry[] = [];

for (const def of NETWORK_DEFS) {
  catalog.push({
    id: nodeId(def.id, 0, 0, 0, def.root.full),
    name: def.root.label,
    chapter: def.title,
    category: "core",
    net: def.id,
  });
  def.sections.forEach((section, sectionIndex) => {
    catalog.push({
      id: nodeId(def.id, 1, sectionIndex, 0, section.full),
      name: section.label,
      chapter: def.title,
      category: "category",
      net: def.id,
    });
    (section.items || []).forEach((item, itemIndex) => {
      catalog.push({
        id: nodeId(def.id, 2, sectionIndex, itemIndex, item),
        name: item,
        chapter: def.title,
        category: inferKind(item, section.summary, 2),
        net: def.id,
      });
    });
  });
}

const out = join(process.cwd(), "scripts", "node-catalog.json");
writeFileSync(out, JSON.stringify(catalog, null, 2), "utf-8");
console.log(`已导出 ${catalog.length} 个节点到 ${out}`);

// 输出排水相关网络供挑选（方便 seed 硬编码选点）
const drainage = catalog.filter((c) => c.net === "drainage");
console.log(`drainage 网络节点数: ${drainage.length}`);
for (const c of drainage.slice(0, 30)) {
  console.log(`  [${c.category}] ${c.name}`);
}
