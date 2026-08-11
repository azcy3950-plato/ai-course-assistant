// SWMM INP 注入纯函数:管道阀门(直径缩放)与节点蓄水(洼地面积) — 可单测,无 I/O
export interface ValveMap { [pipeId: string]: number } // 开度 0-1
export interface StorageItem { nodeId: string; capacity: number } // 容量 m³

export function applyValvesStorages(
  inpText: string,
  valves?: ValveMap,
  storages?: StorageItem[],
): { text: string; affected: { valves: string[]; storages: string[] } } {
  const affected = { valves: [] as string[], storages: [] as string[] };
  if ((!valves || Object.keys(valves).length === 0) && (!storages || storages.length === 0)) {
    return { text: inpText, affected };
  }
  const lines = inpText.split("\n");
  const out: string[] = [];
  let inXS = false, inJunc = false;
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper.startsWith("[XSECTIONS]")) { inXS = true; inJunc = false; out.push(line); continue; }
    if (upper.startsWith("[JUNCTIONS]")) { inXS = false; inJunc = true; out.push(line); continue; }
    if (inXS && upper.startsWith("[")) inXS = false;
    if (inJunc && upper.startsWith("[")) inJunc = false;
    if (line.trim() === "" || line.trim().startsWith(";") || line.trim().startsWith("[")) { out.push(line); continue; }
    const parts = line.trim().split(/\s+/);
    // [XSECTIONS] Name Shape Geom1 Geom2 ... :Geom1 为圆管直径(m)
    if (inXS && parts.length >= 3 && valves) {
      const k = valves[parts[0]];
      if (typeof k === "number" && Number.isFinite(k) && k >= 0 && k <= 1) {
        const d = parseFloat(parts[2]);
        if (Number.isFinite(d) && d > 0) {
          parts[2] = (d * (0.3 + 0.7 * k)).toFixed(4);
          out.push(parts.join("\t"));
          affected.valves.push(parts[0]);
          continue;
        }
      }
    }
    // [JUNCTIONS] Name Elev MaxDepth InitDepth SurDepth Aponded(可缺省=0)
    if (inJunc && parts.length >= 4 && storages) {
      const st = storages.find(s => s.nodeId === parts[0] && Number.isFinite(s.capacity) && s.capacity > 0);
      if (st) {
        const ap = parts.length >= 6 ? parseFloat(parts[5]) : 0;
        const apNew = (Number.isFinite(ap) ? ap : 0) + st.capacity / 0.5; // 0.5m 蓄水深度折算
        while (parts.length < 6) parts.push("0");
        parts[5] = apNew.toFixed(2);
        out.push(parts.join("\t"));
        affected.storages.push(parts[0]);
        continue;
      }
    }
    out.push(line);
  }
  return { text: out.join("\n"), affected };
}
