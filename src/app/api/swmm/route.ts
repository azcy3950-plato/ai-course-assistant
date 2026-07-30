import { NextRequest, NextResponse } from "next/server";

const PY_SCRIPT = [
  "import json, sys",
  "from pyswmm import Simulation, Nodes, Subcatchments, Links",
  "inp_file = sys.argv[1]",
  "sim = Simulation(inp_file)",
  "results = {'max_depth': 0, 'flooding': 0, 'timesteps': 0, 'nodes': {}, 'subcatchments': {}, 'links': {}}",
  "for step in sim:",
  "    results['timesteps'] += 1",
  "    for node in Nodes(sim):",
  "        nid = node.nodeid",
  "        if nid not in results['nodes']: results['nodes'][nid] = {'maxD':0, 'flood':0}",
  "        d = round(node.depth, 3)",
  "        if d > results['nodes'][nid]['maxD']: results['nodes'][nid]['maxD'] = d",
  "        if node.flooding > 0: results['nodes'][nid]['flood'] += round(node.flooding, 3)",
  "        if d > results['max_depth']: results['max_depth'] = d",
  "        results['flooding'] += node.flooding",
  "    for sub in Subcatchments(sim):",
  "        sid = sub.subcatchmentid",
  "        if sid not in results['subcatchments']: results['subcatchments'][sid] = 0",
  "        results['subcatchments'][sid] += round(sub.runoff, 3)",
  "    for link in Links(sim):",
  "        lid = link.linkid",
  "        if lid not in results['links']: results['links'][lid] = {'maxQ': 0, 'surcharged': False}",
  "        if link.flow > results['links'][lid]['maxQ']: results['links'][lid]['maxQ'] = round(link.flow, 3)",
  "        if hasattr(link, 'is_surcharged') and link.is_surcharged(): results['links'][lid]['surcharged'] = True",
  "sim.close()",
  "results['flooding'] = round(results['flooding'], 3)",
  "print(json.dumps(results))",
].join("\n");

function chicagoHyetograph(totalDepth: number, durationHrs: number, peakRatio: number, intervalMin: number): number[] {
  // Chicago design storm (Keifer & Chu, 1957)
  // totalDepth: total rainfall in mm
  // durationHrs: storm duration in hours
  // peakRatio: r = time-to-peak / duration (typically 0.3-0.5)
  // Returns array of intensities (mm/h) at each interval
  const intervals = Math.floor((durationHrs * 60) / intervalMin);
  const intensities: number[] = [];

  // Beijing parameters (approximate, based on design storm curves)
  const A = 2000;
  const B = 8;
  const n = 0.75;

  for (let i = 0; i <= intervals; i++) {
    const tMin = i * intervalMin;
    const tb = peakRatio * durationHrs * 60; // time to peak in minutes
    let intensity: number;

    if (tMin <= tb) {
      // Before peak
      const ta = tb - tMin;
      if (ta < 0.001) {
        intensity = A / Math.pow(B, n);
      } else {
        // Chicago formula: i_before = a * [(1-n)*t/r + b] / [(t/r + b)^(n+1)]
        const tr = ta / peakRatio;
        intensity = A * ((1 - n) * tr / peakRatio + B) / Math.pow(tr / peakRatio + B, n + 1);
      }
    } else {
      // After peak
      const ta = tMin - tb;
      const tr = ta / (1 - peakRatio);
      intensity = A * ((1 - n) * tr + B) / Math.pow(tr + B, n + 1);
    }

    // Clamp and scale
    intensity = Math.max(0, Math.min(intensity, 300));
    intensities.push(Math.round(intensity * 10) / 10);
  }

  // Scale to match total depth
  const sum = intensities.reduce((a, b) => a + b, 0);
  const targetSum = totalDepth / (intervalMin / 60);
  const scale = targetSum / (sum || 1);

  return intensities.map(v => Math.round(v * scale * 10) / 10);
}

export async function POST(req: NextRequest) {
  try {
    const p = await req.json();
    const I = p.intensity || 80; // total rainfall depth in mm
    const imp = p.impervious || 50; // base imperviousness %

    // Generate Chicago hyetograph: 2-hour storm, peak at 40% of duration
    const hyeto = chicagoHyetograph(I, 2.0, 0.4, 5);

    // Build time series lines
    const tsLines = hyeto.map((val, i) => {
      const hrs = Math.floor((i * 5) / 60);
      const mins = (i * 5) % 60;
      return `TS_RAIN        ${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}      ${val}`;
    });

    // Beijing city center drainage model
    // Terrain: NW higher (~50m) → SE lower (~40m), slope ~0.1%
    // 8 subcatchments, 8 junctions, 2 outfalls, branched network
    const impRes = imp;
    const impCom = Math.min(imp + 15, 95);
    const impInd = Math.min(imp + 10, 95);
    const impPark = 10; // parks always low impervious

    const inp = [
      "[TITLE]",
      "Beijing Urban Drainage - Realistic Model",
      "",
      "[OPTIONS]",
      "FLOW_UNITS           CMS",
      "INFILTRATION         HORTON",
      "START_DATE           01/01/2023",
      "START_TIME           00:00:00",
      "END_DATE             01/01/2023",
      "END_TIME             04:00:00",
      "REPORT_STEP          00:05:00",
      "WET_STEP             00:01:00",
      "DRY_STEP             00:30:00",
      "ROUTING_STEP         00:00:30",
      "ALLOW_PONDING        YES",
      "MIN_SLOPE            0.0005",
      "",
      "[RAINGAGES]",
      "RG1          INTENSITY 0:05     1.0      TIMESERIES TS_RAIN",
      "",
      "[SUBCATCHMENTS]",
      `S_NW         RG1       J_NW       2.5      ${impRes}      180       1.2      0`,
      `S_NE         RG1       J_NE       2.0      ${impCom}      150       1.0      0`,
      `S_W          RG1       J_W        3.0      ${impRes}      200       1.5      0`,
      `S_C          RG1       J_C        2.0      ${impCom}      160       0.8      0`,
      `S_E          RG1       J_E        2.5      ${impInd}      170       1.0      0`,
      `S_SW         RG1       J_SW       3.5      ${impPark}     220       2.0      0`,
      `S_SE         RG1       J_SE       2.0      ${impInd}      140       0.8      0`,
      `S_M          RG1       J_M        1.5      ${impCom}      130       0.5      0`,
      "",
      "[SUBAREAS]",
      "S_NW          0.7      0.01      0.1       0.1       25        OUTLET",
      "S_NE          0.8      0.01      0.1       0.1       25        OUTLET",
      "S_W           0.65     0.01      0.1       0.1       25        OUTLET",
      "S_C           0.8      0.01      0.1       0.1       25        OUTLET",
      "S_E           0.75     0.01      0.1       0.1       25        OUTLET",
      "S_SW          0.2      0.01      0.1       0.1       25        OUTLET",
      "S_SE          0.8      0.01      0.1       0.1       25        OUTLET",
      "S_M           0.75     0.01      0.1       0.1       25        OUTLET",
      "",
      "[INFILTRATION]",
      "S_NW          3.0      0.5       0.25      7.0       0",
      "S_NE          3.0      0.5       0.25      7.0       0",
      "S_W           3.0      0.5       0.25      7.0       0",
      "S_C           3.0      0.5       0.25      7.0       0",
      "S_E           3.0      0.5       0.25      7.0       0",
      "S_SW          10.0     2.0       0.5       15.0      0",
      "S_SE          3.0      0.5       0.25      7.0       0",
      "S_M           3.0      0.5       0.25      7.0       0",
      "",
      "[JUNCTIONS]",
      ";;Name        InvertEl  MaxDepth  InitDepth  SurchargeDepth  PondedArea",
      ";; Real SRTM 30m elevations: NW~52m, SE~50m, slope ~0.13%",
      "J_NW            49.5      3.5       0          0               120",
      "J_NE            50.5      3.5       0          0               100",
      "J_W             49.5      3.5       0          0               150",
      "J_C             50.5      3.5       0          0               180",
      "J_E             50.5      3.5       0          0               130",
      "J_SW            49.5      3.5       0          0               200",
      "J_SE            47.5      3.5       0          0               140",
      "J_M             47.0      4.0       0          0               300",
      "",
      "[OUTFALLS]",
      ";; Real SRTM: outfall area ~48m, river invert lower",
      "O_RIVER         45.0      FREE      NO",
      "O_OVERFLOW      48.5      FREE      NO",
      "",
      "[CONDUITS]",
      ";;              Inlet     Outlet       Length  ManningN  InletOffset  OutletOffset",
      "C_NW_W          J_NW      J_W          420     0.013     0            0.3",
      "C_NE_W          J_NE      J_W          380     0.013     0            0.3",
      "C_W_C           J_W       J_C          350     0.013     0            0.3",
      "C_C_M           J_C       J_M          450     0.013     0            0.5",
      "C_E_SW          J_E       J_SW         400     0.013     0            0.3",
      "C_SE_SW         J_SE      J_SW         380     0.013     0            0.3",
      "C_SW_M          J_SW      J_M          400     0.013     0            0.5",
      "C_M_RIVER       J_M       O_RIVER      500     0.013     0            0",
      "C_M_OVERFLOW    J_M       O_OVERFLOW   200     0.013     1.0          0",
      "",
      "[XSECTIONS]",
      "C_NW_W          CIRCULAR  1.2       0      0      0      1",
      "C_NE_W          CIRCULAR  1.2       0      0      0      1",
      "C_W_C           CIRCULAR  1.5       0      0      0      1",
      "C_C_M           CIRCULAR  1.8       0      0      0      1",
      "C_E_SW          CIRCULAR  1.2       0      0      0      1",
      "C_SE_SW         CIRCULAR  1.0       0      0      0      1",
      "C_SW_M          CIRCULAR  1.5       0      0      0      1",
      "C_M_RIVER       CIRCULAR  2.5       0      0      0      1",
      "C_M_OVERFLOW    RECT_OPEN 1.5       1.0    0      0      1",
      "",
      "[TIMESERIES]",
      ...tsLines,
      "TS_RAIN         " + String(hyeto.length * 5).padStart(2, '0') + ":00      0.0",
      "",
      "[REPORT]",
      "NODES            ALL",
      "SUBCATCHMENTS    ALL",
      "LINKS            ALL",
    ].join("\n");

    const { writeFileSync, unlinkSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { execSync } = await import("child_process");

    const base = join(tmpdir(), "swmm-" + Date.now());
    const inpFile = base + ".inp";
    const pyFile = base + ".py";
    writeFileSync(inpFile, inp);
    writeFileSync(pyFile, PY_SCRIPT);

    try {
      const output = execSync("python3 " + pyFile + " " + inpFile, {
        timeout: 90000,
        encoding: "utf-8",
      });
      const data = JSON.parse(output.trim());
      try { unlinkSync(inpFile); unlinkSync(pyFile); } catch (e) {}

      return NextResponse.json({
        ok: true,
        params: { intensity: I, impervious: imp },
        summary: {
          maxDepth: data.max_depth || 0,
          totalFlooding: data.flooding || 0,
          timesteps: data.timesteps || 0,
        },
        nodes: data.nodes || {},
        subcatchments: data.subcatchments || {},
        links: data.links || {},
      });
    } catch (simErr: any) {
      try { unlinkSync(inpFile); unlinkSync(pyFile); } catch (e) {}
      return NextResponse.json(
        { ok: false, error: "SWMM error: " + (simErr.stderr || simErr.message) },
        { status: 500 }
      );
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
