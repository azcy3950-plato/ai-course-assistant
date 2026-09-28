// ═══════════════════════════════════════════════════════════
// INP PARSER — SWMM .inp 文本解析为 3D 场景数据结构(纯函数,可单测)
// ═══════════════════════════════════════════════════════════

export const CENTER_X = 529350, CENTER_Y = 305850;

export interface Node3D {
  id: string; x: number; z: number;
  invert: number; maxD: number; initD: number;
  ground: number; type: string;
}
export interface Pipe3D {
  id: string; from: string; to: string;
  diam: number; length: number; roughness: number;
  fromInv: number; toInv: number;
  shape: string; inOffset: number; outOffset: number;
  verts: [number, number][];
}
export interface SC3D {
  id: string; pts: [number, number][];
  imperv: number; area: number; outlet: string;
  width: number; slope: number;
}

export interface ParsedInp {
  nodes: Node3D[];
  pipes: Pipe3D[];
  scs: SC3D[];
  outfallIds: Set<string>;
}

// 提取 SWMM 段落:从 [S] 段头之后开始,遇到下一个以 [ 开头的段头即停
// (不依赖结束段名——[XSECTIONS] 与 [TIMESERIES] 之间可能隔着
//  [POLLUTANTS]/[LANDUSES]/[COVERAGES] 等段,按名截取会污染解析)
// 段头匹配大小写不敏感([Polygons]/[POLYGONS] 均可)
function sec(t: string, s: string) {
  const up = t.toUpperCase();
  const us = s.toUpperCase();
  const si = up.indexOf(us);
  if (si < 0) return "";
  const rest = t.substring(si + s.length);
  const lines = rest.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) break;
    out.push(line);
  }
  return out.join("\n");
}
function toX(x: number) { return (x - CENTER_X); }
function toZ(y: number) { return -(y - CENTER_Y); }

export function parseInp(text: string): ParsedInp {
  const coordSec = sec(text, "[COORDINATES]");
  const juncSec  = sec(text, "[JUNCTIONS]");
  const outfSec  = sec(text, "[OUTFALLS]");
  const condSec  = sec(text, "[CONDUITS]");
  const xsecSec  = sec(text, "[XSECTIONS]");
  const subcSec  = sec(text, "[SUBCATCHMENTS]");
  const vertSec  = sec(text, "[VERTICES]");
  const polySec  = sec(text, "[Polygons]");

  type RawNode = { x: number; z: number; invert: number; maxD: number; initD: number; type: string };
  const rawNodes = new Map<string, RawNode>();

  coordSec.split("\n").forEach(line => {
    const m = line.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)/);
    if (m) rawNodes.set(m[1], { x: toX(parseFloat(m[2])), z: toZ(parseFloat(m[3])), invert: 0, maxD: 3.5, initD: 0, type: "junction" });
  });
  juncSec.split("\n").forEach(line => {
    const m = line.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (m && rawNodes.has(m[1])) { const n = rawNodes.get(m[1])!; n.invert = parseFloat(m[2]); n.maxD = parseFloat(m[3]); n.initD = parseFloat(m[4]) || 0; }
  });
  const outfallIds = new Set<string>();
  outfSec.split("\n").forEach(line => {
    const m = line.trim().match(/^(\S+)\s+([\d.]+)/);
    if (m) { outfallIds.add(m[1]); if (rawNodes.has(m[1])) { rawNodes.get(m[1])!.invert = parseFloat(m[2]); rawNodes.get(m[1])!.type = "outfall"; } }
  });

  const diamMap = new Map<string, number>();
  const shapeMap = new Map<string, string>();
  xsecSec.split("\n").forEach(line => {
    const m = line.trim().match(/^(\S+)\s+(\S+)\s+([\d.]+)/);
    if (m) { diamMap.set(m[1], parseFloat(m[3])); shapeMap.set(m[1], m[2]); }
  });

  const pipes: Pipe3D[] = [];
  condSec.split("\n").forEach(line => {
    const m = line.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (m) {
      const fn = rawNodes.get(m[2]), tn = rawNodes.get(m[3]);
      pipes.push({
        id: m[1], from: m[2], to: m[3],
        diam: diamMap.get(m[1]) || 0.3, length: parseFloat(m[4]),
        roughness: parseFloat(m[5]) || 0.013,
        fromInv: fn?.invert || 0, toInv: tn?.invert || 0,
        shape: shapeMap.get(m[1]) || "CIRCULAR",
        inOffset: parseFloat(m[6]) || 0, outOffset: parseFloat(m[7]) || 0,
        verts: [],
      });
    }
  });

  const vertMap = new Map<string, [number, number][]>();
  vertSec.split("\n").forEach(line => {
    const m = line.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)/);
    if (m) { if (!vertMap.has(m[1])) vertMap.set(m[1], []); vertMap.get(m[1])!.push([toX(parseFloat(m[2])), toZ(parseFloat(m[3]))]); }
  });
  pipes.forEach(p => { p.verts = vertMap.get(p.id) || []; });

  const impervMap = new Map<string, number>(), scArea = new Map<string, number>();
  const scOutlet = new Map<string, string>(), scWidth = new Map<string, number>(), scSlope = new Map<string, number>();
  subcSec.split("\n").forEach(line => {
    // [SUBCATCHMENTS] Name RainGage Outlet Area %Imperv Width %Slope ...
    const m = line.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (m) { scOutlet.set(m[1], m[3]); scArea.set(m[1], parseFloat(m[4])); impervMap.set(m[1], parseFloat(m[5])); scWidth.set(m[1], parseFloat(m[6]) || 0); scSlope.set(m[1], parseFloat(m[7]) || 0); }
  });

  const scs: SC3D[] = [];
  let curId = "", curPts: [number, number][] = [];
  polySec.split("\n").forEach(line => {
    const m = line.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)/);
    if (m) {
      if (m[1] !== curId) {
        if (curPts.length >= 3) scs.push({ id: curId, pts: curPts, imperv: impervMap.get(curId) ?? 50, area: scArea.get(curId) ?? 0, outlet: scOutlet.get(curId) || "", width: scWidth.get(curId) ?? 0, slope: scSlope.get(curId) ?? 0 });
        curId = m[1]; curPts = [];
      }
      curPts.push([toX(parseFloat(m[2])), toZ(parseFloat(m[3]))]);
    }
  });
  if (curPts.length >= 3) scs.push({ id: curId, pts: curPts, imperv: impervMap.get(curId) ?? 50, area: scArea.get(curId) ?? 0, outlet: scOutlet.get(curId) || "", width: scWidth.get(curId) ?? 0, slope: scSlope.get(curId) ?? 0 });

  const nodeList: Node3D[] = [];
  rawNodes.forEach((n, id) => { nodeList.push({ id, x: n.x, z: n.z, invert: n.invert, maxD: n.maxD, initD: n.initD, ground: n.invert + n.maxD, type: n.type }); });
  return { nodes: nodeList, pipes, scs, outfallIds };
}
