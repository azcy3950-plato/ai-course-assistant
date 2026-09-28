export type SwmmConcentrationUnit = "MG/L" | "UG/L" | "COUNT/L";

export interface SwmmPollutantDefinition {
  name: string;
  concentrationUnit: SwmmConcentrationUnit;
  massUnit: "kg" | "count";
  /** CMS × concentration → mass rate in kg/s. Null for non-mass pollutants. */
  cmsMassRateFactor: number | null;
}

export interface SwmmOutfallLoadingRow {
  id: string;
  flowFrequencyPercent: number;
  averageFlow: number;
  maximumFlow: number;
  totalVolumeMillionLiters: number;
  pollutantLoads: Record<string, number>;
}

export interface SwmmOutfallLoadingSummary {
  rows: Record<string, SwmmOutfallLoadingRow>;
  system: SwmmOutfallLoadingRow | null;
}

export interface SwmmQualityModelConfiguration {
  totalSubcatchments: number;
  coveredSubcatchments: number;
  coveragePercent: number;
  coveredSubcatchmentsFullyOccupiedByLid: number;
}

function sectionRows(inpText: string, sectionName: string): string[][] {
  const lines = inpText.replace(/\r\n?/g, "\n").split("\n");
  const target = `[${sectionName.toUpperCase()}]`;
  let inSection = false;
  const rows: string[][] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      const heading = line.split(/\s*;/, 1)[0].toUpperCase();
      if (heading === target) {
        inSection = true;
        continue;
      }
      if (inSection) break;
    }
    if (!inSection || !line || line.startsWith(";")) continue;
    const withoutComment = line.split(";", 1)[0].trim();
    if (withoutComment) rows.push(withoutComment.split(/\s+/));
  }
  return rows;
}

/** Read pollutant IDs and concentration units in the same order SWMM writes them to .out/.rpt. */
export function parseSwmmPollutants(inpText: string): SwmmPollutantDefinition[] {
  return sectionRows(inpText, "POLLUTANTS").flatMap(parts => {
    if (parts.length < 2) return [];
    const concentrationUnit = parts[1].toUpperCase() as SwmmConcentrationUnit;
    if (!(["MG/L", "UG/L", "COUNT/L"] as string[]).includes(concentrationUnit)) return [];
    return [{
      name: parts[0],
      concentrationUnit,
      massUnit: concentrationUnit === "COUNT/L" ? "count" as const : "kg" as const,
      // Q (m3/s) × C (mg/L) × 1000 L/m3 ÷ 1e6 mg/kg = Q × C / 1000 kg/s.
      cmsMassRateFactor: concentrationUnit === "MG/L" ? 1e-3 : concentrationUnit === "UG/L" ? 1e-6 : null,
    }];
  });
}

export function parseSwmmOutfalls(inpText: string): string[] {
  return sectionRows(inpText, "OUTFALLS").map(parts => parts[0]).filter(Boolean);
}

/** Surface the input coverage limits so a genuine zero-load result is not mistaken for missing API data. */
export function summarizeSwmmQualityModel(inpText: string): SwmmQualityModelConfiguration {
  const subcatchmentRows = sectionRows(inpText, "SUBCATCHMENTS");
  const coverageIds = new Set(sectionRows(inpText, "COVERAGES").map(parts => parts[0]).filter(Boolean));
  const subcatchmentAreasM2 = new Map<string, number>();
  for (const parts of subcatchmentRows) {
    const areaHa = Number(parts[3]);
    if (parts[0] && Number.isFinite(areaHa)) subcatchmentAreasM2.set(parts[0], areaHa * 10_000);
  }
  const lidAreasM2 = new Map<string, number>();
  for (const parts of sectionRows(inpText, "LID_USAGE")) {
    const areaM2 = Number(parts[3]);
    if (!parts[0] || !Number.isFinite(areaM2)) continue;
    lidAreasM2.set(parts[0], (lidAreasM2.get(parts[0]) || 0) + areaM2);
  }
  let fullyOccupiedByLid = 0;
  for (const id of coverageIds) {
    const subcatchmentArea = subcatchmentAreasM2.get(id);
    const lidArea = lidAreasM2.get(id) || 0;
    if (subcatchmentArea && lidArea >= subcatchmentArea * 0.999) fullyOccupiedByLid++;
  }
  const totalSubcatchments = subcatchmentRows.length;
  return {
    totalSubcatchments,
    coveredSubcatchments: coverageIds.size,
    coveragePercent: totalSubcatchments ? Math.round(coverageIds.size / totalSubcatchments * 1000) / 10 : 0,
    coveredSubcatchmentsFullyOccupiedByLid: fullyOccupiedByLid,
  };
}

/**
 * Parse SWMM's engine-generated Outfall Loading Summary. Pollutant columns follow
 * [POLLUTANTS] order; the first four numeric columns are flow frequency, average
 * flow, maximum flow, and total volume (10^6 L for an SI/CMS model).
 */
export function parseSwmmOutfallLoadingSummary(
  reportText: string,
  pollutantNames: string[],
): SwmmOutfallLoadingSummary | null {
  const lines = reportText.replace(/\r\n?/g, "\n").split("\n");
  const headingIndex = lines.findIndex(line => line.trim() === "Outfall Loading Summary");
  if (headingIndex < 0) return null;

  const rows: Record<string, SwmmOutfallLoadingRow> = {};
  let system: SwmmOutfallLoadingRow | null = null;
  const requiredNumericColumns = 4 + pollutantNames.length;

  for (let i = headingIndex + 1; i < Math.min(lines.length, headingIndex + 250); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 1 + requiredNumericColumns) continue;
    const values = parts.slice(1, 1 + requiredNumericColumns).map(Number);
    if (values.some(value => !Number.isFinite(value))) continue;

    const pollutantLoads: Record<string, number> = {};
    pollutantNames.forEach((name, index) => { pollutantLoads[name] = values[4 + index]; });
    const row: SwmmOutfallLoadingRow = {
      id: parts[0],
      flowFrequencyPercent: values[0],
      averageFlow: values[1],
      maximumFlow: values[2],
      totalVolumeMillionLiters: values[3],
      pollutantLoads,
    };
    rows[row.id] = row;
    if (row.id.toLowerCase() === "system") {
      system = row;
      break;
    }
  }

  return system ? { rows, system } : null;
}
