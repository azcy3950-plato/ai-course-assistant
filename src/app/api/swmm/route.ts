import { NextRequest, NextResponse } from 'next/server';
import { verify as jwtVerify } from 'jsonwebtoken';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { applyValvesStorages, parseValveValue, applyGreenLevel } from '@/lib/swmm-inject';

// ─── Task store ───
interface SimTask {
  simulationId: string;
  intensity: number;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  result?: any;
  error?: string;
}
const tasks = new Map<string, SimTask>();

const SIM_DIR = join(tmpdir(), 'swmm_simulations');

function cleanupStaleTasks() {
  const now = Date.now();
  const TTL = 30 * 60 * 1000;
  for (const [id, task] of tasks) {
    if (task.completedAt && now - task.completedAt > TTL) {
      tasks.delete(id);
      // Clean up simulation directory
      const dir = join(SIM_DIR, id);
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
    if (task.status === 'running' && now - task.startedAt > 120000) {
      task.status = 'failed'; task.error = 'Timeout'; task.completedAt = now;
    }
  }
}

// ─── Modify INP ───

// 真实设计暴雨时序:解析 [TIMESERIES] 中按重现期命名的序列(3A/5A/10A/20A/50A)
// 每个序列:5min 步长,288 步(0:00–23:55),INTENSITY(mm/h)
// 返回元数据:累计雨量(mm)、峰值雨强(mm/h)、峰值时刻、有雨时长(h)
interface RainfallSeries {
  name: string;
  ts: Array<{ t: string; v: number }>;   // 原始 288 点(按时间升序)
  totalRainfall: number;                  // 累计 mm = Σ v × 5min?(5/60h)
  peakIntensity: number;                  // 峰值 mm/h
  peakTime: string;                       // HH:MM
  durationH: number;                      // 有雨持续 h
}
function parseRainfallSeries(inpText: string): Record<string, RainfallSeries> {
  const start = inpText.toUpperCase().indexOf('[TIMESERIES]');
  if (start < 0) return {};
  const rest = inpText.slice(start + '[TIMESERIES]'.length);
  const end = rest.search(/\n\s*\[/); // 下一个段
  const block = end >= 0 ? rest.slice(0, end) : rest;
  const by: Record<string, Array<{ t: string; v: number }>> = {};
  for (const line of block.split('\n')) {
    const lt = line.trim();
    if (!lt || lt.startsWith(';') || lt.startsWith('[')) continue;
    const p = lt.split(/\s+/);
    if (p.length >= 4) {
      const name = p[0]; const t = p[2]; const v = parseFloat(p[3]);
      if (!isNaN(v)) (by[name] = by[name] || []).push({ t, v });
    }
  }
  const result: Record<string, RainfallSeries> = {};
  for (const name of Object.keys(by)) {
    const rows = by[name];
    let total = 0, peak = 0, peakTime = '', first: string | null = null, last: string | null = null;
    const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    for (const r of rows) {
      const v = r.v;
      if (v > 0) { if (first == null) first = r.t; last = r.t; }
      total += v * (5 / 60); // 5min 步长 → mm
      if (v > peak) { peak = v; peakTime = r.t; }
    }
    let dur = 0;
    if (first && last) {
      const dtMin = toMin(last) - toMin(first) + 5;
      dur = Math.max(0, dtMin / 60);
    }
    result[name] = { name, ts: rows, totalRainfall: Math.round(total * 10) / 10, peakIntensity: Math.round(peak * 10) / 10, peakTime, durationH: Math.round(dur * 100) / 100 };
  }
  return result;
}

function modifyRainfall(originalInpPath: string, intensity: number, simDir: string, landcover?: string, greenLevel?: number, seriesName?: string, seriesMap?: Record<string, RainfallSeries>): string {
  const tempInp = join(simDir, 'model.inp');
  let text = readFileSync(originalInpPath, 'utf-8');
  const lines = text.split('\n');
  const result: string[] = [];
  let inTS = false;
  // 真实序列:时间(如 "1:25")→ 原始雨强值 map;命中则按真实值写回,不再乘倍率
  const series = seriesName && seriesMap ? seriesMap[seriesName] : undefined;
  const seriesVal = new Map<string, number>();
  if (series) for (const r of series.ts) seriesVal.set(r.t, r.v);
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper.startsWith('[TIMESERIES]')) { inTS = true; result.push(line); continue; }
    if (inTS && line.trim().startsWith('[') && !upper.startsWith('[TIMESERIES]')) inTS = false;
    if (inTS && !line.trim().startsWith(';') && line.trim() !== '' && !line.trim().startsWith('[')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const lastIdx = parts.length - 1;
        const val = parseFloat(parts[lastIdx]);
        if (Number.isFinite(val) && val > 0.0001) {
          if (series) {
            // 用真实设计暴雨原始值(不放大,数据源自 INP [TIMESERIES])
            const real = seriesVal.get(parts[2]);
            if (real != null) { parts[lastIdx] = real.toFixed(6); result.push(parts.join('\t')); continue; }
          }
          parts[lastIdx] = (val * (intensity / 100)).toFixed(6);
          result.push(parts.join('\t'));
          continue;
        }
      }
    }
    result.push(line);
  }
  text = result.join('\n');

  // ── 下垫面方案:调整各汇水区不透水率(%Imperv)与不透水糙率(N-Imperv) ──
  // landcover: "gray" = 灰色强开发(提高不透水率) / "green" = 绿色海绵(降低不透水率)
  if (landcover === "gray" || landcover === "green") {
    const lines2 = text.split('\n');
    const out: string[] = [];
    let inSub = false, inSubarea = false;
    for (const line of lines2) {
      const upper = line.trim().toUpperCase();
      if (upper.startsWith('[SUBCATCHMENTS]')) { inSub = true; inSubarea = false; out.push(line); continue; }
      if (upper.startsWith('[SUBAREAS]')) { inSub = false; inSubarea = true; out.push(line); continue; }
      if (inSub && upper.startsWith('[')) inSub = false;
      if (inSubarea && upper.startsWith('[')) inSubarea = false;
      if (line.trim() === '' || line.trim().startsWith(';') || line.trim().startsWith('[')) { out.push(line); continue; }
      const parts = line.trim().split(/\s+/);
      if (inSub && parts.length >= 5) {
        // [SUBCATCHMENTS] Name Rain-Gage Outlet Area %Imperv Width %Slope ...
        const imperv = parseFloat(parts[4]);
        if (Number.isFinite(imperv)) {
          // gray 灰色强开发:向 100% 不透水收敛(0%→60%,100% 保持 100%)
          // green 绿色海绵:applyGreenLevel 线性插值(level=0 现状不变,1 全绿色 imperv×0.5)
          const adjusted = landcover === "gray"
            ? Math.min(100, Math.max(0, imperv + (100 - imperv) * 0.6))
            : applyGreenLevel(imperv, 0, greenLevel ?? 1).imperv;
          parts[4] = adjusted.toFixed(2);
          out.push(parts.join('\t'));
          continue;
        }
      }
      if (inSubarea && parts.length >= 3) {
        // [SUBAREAS] Subcatchment N-Imperv N-Perv ... (第2列 N-Imperv)
        const nImp = parseFloat(parts[1]);
        if (Number.isFinite(nImp) && nImp > 0) {
          // gray:糙率降 20%(下限 0.01);green:applyGreenLevel 线性插值(level=0 原值、1 ×4,上限 0.2,无下限防 level=0 漂移)
          parts[1] = (landcover === "gray" ? Math.max(0.01, Math.min(0.05, nImp * 0.8)) : Math.min(0.2, applyGreenLevel(0, nImp, greenLevel ?? 1).nImperv)).toFixed(4);
          out.push(parts.join('\t'));
          continue;
        }
      }
      out.push(line);
    }
    text = out.join('\n');
  }

  writeFileSync(tempInp, text, 'utf-8');
  return tempInp;
}

// ─── Run SWMM + read .out ───
function runSimulation(tempInp: string, simulationId: string, simDir: string): any {
  const outJson = join(simDir, 'result.json');
  const pyFile = join(simDir, 'run.py');

  const pyScript = `
import json, sys, os, math
from datetime import datetime
from pyswmm import Simulation, Output
from swmm.toolkit.shared_enum import LinkAttribute, NodeAttribute

inp_path = ${JSON.stringify(tempInp)}
out_json = ${JSON.stringify(outJson)}
sim_dir = ${JSON.stringify(simDir)}

# Run simulation
rpt_path = inp_path.replace('.inp', '.rpt')
out_path = inp_path.replace('.inp', '.out')

with Simulation(inp_path) as sim:
    sim.execute()

if not os.path.exists(out_path):
    raise FileNotFoundError(f'OUT file not found: {out_path}')

# Read .out file
with Output(out_path) as out:
    times = out.times
    period = out.period
    t0 = times[0]
    timestamps = [round((t - t0).total_seconds() / 3600, 4) for t in times]

    # Parse XSECTIONS from INP for fullDepth
    link_full_depths = {}
    with open(inp_path, 'r', encoding='utf-8', errors='ignore') as f:
        inp_text = f.read()
    xsec_start = inp_text.find('[XSECTIONS]')
    if xsec_start >= 0:
        for line in inp_text[xsec_start:].split('\\n'):
            line = line.strip()
            if not line or line.startswith(';'): continue
            if line.startswith('[') and not line.upper().startswith('[XSECTIONS]'): break
            parts = line.split()
            if len(parts) >= 3:
                try:
                    geom1 = float(parts[2])
                    if geom1 > 0.01:
                        link_full_depths[parts[0]] = geom1
                except: pass

    # ── Links ──
    links_data = {}
    for lid in out.links:
        fd_val = link_full_depths.get(lid, 0.3)
        link_data = {"flow": [], "depth": [], "velocity": [], "volume": [], "capacity": [], "depthFraction": []}
        fd = {}; fv = {}; fdp = {}; fvl = {}; fcp = {}
        try: fd = out.link_series(lid, LinkAttribute.FLOW_RATE)
        except: pass
        try: fdp = out.link_series(lid, LinkAttribute.FLOW_DEPTH)
        except: pass
        try: fv = out.link_series(lid, LinkAttribute.FLOW_VELOCITY)
        except: pass
        try: fvl = out.link_series(lid, LinkAttribute.FLOW_VOLUME)
        except: pass
        try: fcp = out.link_series(lid, LinkAttribute.CAPACITY)
        except: pass
        for t in times:
            link_data["flow"].append(round(fd.get(t, 0), 3))
            d = fdp.get(t, 0)
            link_data["depth"].append(round(d, 3))
            link_data["velocity"].append(round(fv.get(t, 0), 3))
            link_data["volume"].append(round(fvl.get(t, 0), 3))
            link_data["capacity"].append(round(fcp.get(t, 0), 3))
            link_data["depthFraction"].append(round(min(1.0, max(0, d / max(0.01, fd_val))), 3))
        links_data[lid] = link_data

    # ── Nodes (correct PySWMM attribute names) ──
    nodes_data = {}
    for nid in out.nodes:
        node_data = {"depth": [], "totalInflow": [], "pondedVolume": [], "floodingLosses": []}
        nd = {}; ni = {}; np = {}; nf = {}
        try: nd = out.node_series(nid, NodeAttribute.INVERT_DEPTH)
        except: pass
        try: ni = out.node_series(nid, NodeAttribute.TOTAL_INFLOW)
        except: pass
        try: np = out.node_series(nid, NodeAttribute.PONDED_VOLUME)
        except: pass
        try: nf = out.node_series(nid, NodeAttribute.FLOODING_LOSSES)
        except: pass
        for t in times:
            node_data["depth"].append(round(max(0, nd.get(t, 0)), 3))
            node_data["totalInflow"].append(round(ni.get(t, 0), 3))
            node_data["pondedVolume"].append(round(max(0, np.get(t, 0)), 3))
            node_data["floodingLosses"].append(round(max(0, nf.get(t, 0)), 3))
        nodes_data[nid] = node_data

    # ── Filter active ──
    active_nodes = {nid: nd for nid, nd in nodes_data.items() if any(abs(d) > 0.0005 for d in nd["depth"])}
    active_links = {lid: ld for lid, ld in links_data.items() if any(abs(f) > 0.0005 for f in ld["flow"])}

    # ── Summary with complete maxDepth/maxFlow ──
    max_d_val = 0; max_d_nid = None; max_d_ts = None
    for nid, nd in active_nodes.items():
        for i, d in enumerate(nd["depth"]):
            if d > max_d_val: max_d_val = d; max_d_nid = nid; max_d_ts = timestamps[i] if i < len(timestamps) else None

    max_f_val = 0; max_f_lid = None; max_f_ts = None; max_f_signed = 0
    for lid, ld in active_links.items():
        for i, f in enumerate(ld["flow"]):
            af = abs(f)
            if af > max_f_val:
                max_f_val = af; max_f_lid = lid; max_f_signed = f
                max_f_ts = timestamps[i] if i < len(timestamps) else None

    # Determine flow direction
    max_f_dir = None
    if max_f_lid:
        # Get link connections to determine from→to
        conn_start = inp_text.find('[CONDUITS]')
        if conn_start >= 0:
            for line in inp_text[conn_start:].split('\\n'):
                parts = line.strip().split()
                if len(parts) >= 4 and parts[0] == max_f_lid:
                    max_f_dir = parts[1] + '→' + parts[2] if max_f_signed >= 0 else parts[2] + '→' + parts[1]
                    break

    result = {
        "timeStepCount": period,
        "timestamps": timestamps,
        "metadata": {"startTime": str(times[0]), "endTime": str(times[-1]), "flowUnits": "CMS"},
        "nodes": active_nodes,
        "links": active_links,
        "summary": {
            "maxDepth": {"value": round(max_d_val, 3), "nodeId": max_d_nid, "timestamp": max_d_ts},
            "maxFlow": {
                "value": round(max_f_val, 3),
                "linkId": max_f_lid,
                "timestamp": max_f_ts,
                "signedValue": round(max_f_signed, 3),
                "direction": max_f_dir,
            },
            "totalNodes": len(out.nodes), "totalLinks": len(out.links),
            "activeNodes": len(active_nodes), "activeLinks": len(active_links),
        }
    }

    with open(out_json, 'w') as f:
        json.dump(result, f)

    print(f'DONE period={period} totalLinks={len(out.links)} activeLinks={len(active_links)} activeNodes={len(active_nodes)} maxDepth={round(max_d_val,3)}@{max_d_nid} maxFlow={round(max_f_val,3)}@{max_f_lid}')
`.trim();

  writeFileSync(pyFile, pyScript, 'utf-8');

  try {
    const stdout = execSync(`python3 ${pyFile}`, {
      timeout: 120000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8',
    });
    console.log('[SWMM]', stdout.trim());

    if (existsSync(outJson)) {
      return JSON.parse(readFileSync(outJson, 'utf-8'));
    }
    throw new Error('No output JSON produced');
  } finally {
    // Keep .out and .rpt for debugging; they'll be cleaned with the simDir
  }
}

// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// 鉴权:与 /api/agent 一致,解析 JWT 邮箱,无效即 401
function getUserEmail(req: NextRequest): string {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const jwtSecret = process.env.JWT_SECRET;
  if (!token || !jwtSecret) return "";
  try {
    return (jwtVerify(token, jwtSecret) as { email?: string }).email || "";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  try {
    const userEmail = getUserEmail(req);
    if (!userEmail) return NextResponse.json({ error: "未登录" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const rawIntensity = body.intensity == null ? NaN : Number(body.intensity);
    const intensity = Number.isFinite(rawIntensity) ? Math.max(10, Math.min(500, rawIntensity)) : 80;
    const landcover = ["gray", "green"].includes(body.landcover) ? body.landcover : undefined;
    // 真实设计暴雨重现期序列:3A/5A/10A/20A/50A(取自 INP [TIMESERIES]);可选,命中则按真实雨型跑
    const originalInpForSeries = join(process.cwd(), 'public', 'zijing_inp.inp');
    const rainfallScenarios = parseRainfallSeries(readFileSync(originalInpForSeries, 'utf-8'));
    const allowedSeries = ["3A", "5A", "10A", "20A", "50A"];
    const series = typeof body.series === "string" && allowedSeries.includes(body.series) && rainfallScenarios[body.series] ? body.series : undefined;
    // 绿色海绵强度(0-1):仅 landcover=green 时生效,%Imperv 线性插值
    const rawGL = body.greenLevel == null ? NaN : Number(body.greenLevel);
    const greenLevel = Number.isFinite(rawGL) ? Math.max(0, Math.min(1, rawGL)) : undefined;

    // 阀门(pipeId → 开度 0-1)与蓄水设施(nodeId → 容量 m³):类型校验 + 数值钳制,非法值忽略
    const valves: Record<string, number> = {};
    if (body.valves != null && typeof body.valves === "object" && !Array.isArray(body.valves)) {
      const entries = Object.entries(body.valves as Record<string, unknown>);
      if (entries.length > 50) console.log(`[SWMM] valves 超限截断:${entries.length}→50`);
      for (const [k, v] of entries.slice(0, 50)) {
        // 仅接受数字或非空数字串,null/""/布尔等非法值忽略(避免 Number(null)=0 误关阀门)
        const parsed = parseValveValue(v);
        if (parsed != null && k.length <= 64) valves[k] = parsed;
      }
    }
    const storages: Array<{ nodeId: string; capacity: number }> = [];
    if (Array.isArray(body.storages)) {
      if (body.storages.length > 20) console.log(`[SWMM] storages 超限截断:${body.storages.length}→20`);
      for (const s of (body.storages as Array<{ nodeId?: unknown; capacity?: unknown }>).slice(0, 20)) {
        if (s && typeof s.nodeId === "string" && s.nodeId && s.nodeId.length <= 64) {
          const cap = Number(s.capacity);
          if (Number.isFinite(cap) && cap > 0) storages.push({ nodeId: s.nodeId, capacity: Math.min(5000, Math.max(50, cap)) });
        }
      }
    }
    cleanupStaleTasks();

    // 并发限流:同时在跑的仿真(含排队中的 running)超过上限时拒绝,防认证用户并发耗尽服务器
    const MAX_CONCURRENT = 2;
    let runningCount = 0;
    for (const t of tasks.values()) { if (t.status === 'running') runningCount++; }
    if (runningCount >= MAX_CONCURRENT) {
      return NextResponse.json({ ok: false, error: '仿真繁忙，请稍后重试（同时最多 2 个仿真）' }, { status: 429 });
    }

    const simulationId = crypto.randomUUID();
    const simDir = join(SIM_DIR, simulationId);
    mkdirSync(simDir, { recursive: true });

    console.log('[SWMM] Starting — intensity:', intensity, 'landcover:', landcover || 'default', 'simId:', simulationId);

    const task: SimTask = { simulationId, intensity, status: 'running', startedAt: Date.now() };
    tasks.set(simulationId, task);

    const originalInp = join(process.cwd(), 'public', 'zijing_inp.inp');
    const tempInp = modifyRainfall(originalInp, intensity, simDir, landcover, greenLevel, series, rainfallScenarios);
    // 阀门/蓄水注入:在雨强与下垫面修改后的文本上再改直径/洼地面积(失败即标记 task failed,不滞留 running 至超时)
    let affected = { valves: [] as string[], storages: [] as string[] };
    try {
      if (Object.keys(valves).length > 0 || storages.length > 0) {
        const injected = applyValvesStorages(readFileSync(tempInp, 'utf-8'), valves, storages);
        writeFileSync(tempInp, injected.text, 'utf-8');
        affected = injected.affected;
      }
    } catch (err: any) {
      task.status = 'failed'; task.error = err.message; task.completedAt = Date.now();
      tasks.set(simulationId, task);
      throw err;
    }

    try {
      const result = runSimulation(tempInp, simulationId, simDir);
      task.status = 'completed'; task.completedAt = Date.now(); task.result = result;
      tasks.set(simulationId, task);

      console.log('[SWMM] Complete — simId:', simulationId,
        '| period:', result.timeStepCount,
        '| maxDepth:', result.summary.maxDepth.value, '@', result.summary.maxDepth.nodeId,
        '| maxFlow:', result.summary.maxFlow.value, '@', result.summary.maxFlow.linkId);

      const scenariosMeta = Object.fromEntries(
        Object.entries(rainfallScenarios).map(([k, s]) => [k, { name: s.name, totalRainfall: s.totalRainfall, peakIntensity: s.peakIntensity, peakTime: s.peakTime, durationH: s.durationH }])
      );
      return NextResponse.json({
        ok: true, simulationId, status: 'completed',
        parameters: { intensity, landcover: landcover || 'default', series },
        affected,
        rainfallScenarios: scenariosMeta,
        rainfall: series && rainfallScenarios[series] ? {
          ...scenariosMeta[series], ts: rainfallScenarios[series].ts,
        } : undefined,
        ...result,
      });
    } catch (err: any) {
      task.status = 'failed'; task.error = err.message; task.completedAt = Date.now();
      tasks.set(simulationId, task);
      throw err;
    }
  } catch (err: any) {
    console.error('[SWMM] Fatal:', err?.message || err);
    // 不向前端回显内部错误细节(可能含服务器路径/INP 片段),仅返回通用提示
    return NextResponse.json({ ok: false, error: '仿真服务暂时不可用,请稍后重试' }, { status: 500 });
  }
}
