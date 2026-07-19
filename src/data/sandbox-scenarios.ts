import { FloodGrid, SimulationTimeline } from '@/types';

// Default map center (Shanghai area - flood-prone region)
export const DEFAULT_CENTER: [number, number] = [31.2304, 121.4737];
export const DEFAULT_ZOOM = 14;

// Sample flood grid data for simulation
function generateFloodGrids(
  intensity: number,
  duration: number,
  timeStep: number
): { grids: FloodGrid[]; timelines: SimulationTimeline[] }[] {
  const steps = Math.ceil(duration / timeStep);
  const result = [];

  // Base grid positions around Shanghai
  const baseLat = 31.228;
  const baseLng = 121.470;
  const gridSize = 30;

  const grids: FloodGrid[][] = [];
  const timelines: SimulationTimeline[] = [];

  for (let step = 0; step <= steps; step++) {
    const progress = step / steps; // 0 to 1
    const time = step * timeStep;

    const stepGrids: FloodGrid[] = [];
    let totalFloodArea = 0;
    let maxDepthValue = 0;
    let highRiskCount = 0;

    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const lat = baseLat + (i * 0.0015);
        const lng = baseLng + (j * 0.002);

        // Simulate flood depth based on position and time
        // Lower elevation areas (center) flood more
        const centerDist = Math.sqrt(
          ((i - gridSize / 2) / gridSize) ** 2 + ((j - gridSize / 2) / gridSize) ** 2
        );

        // Depth increases with intensity, duration, and decreases with distance from center
        const baseDepth = (1 - centerDist * 1.5) * (intensity / 50) * (duration / 60);
        // Depth follows a curve over time: ramps up, peaks, then slowly recedes
        const timeFactor = Math.sin(progress * Math.PI) * (1 + progress * 0.3);
        const depth = Math.max(0, baseDepth * timeFactor + (Math.random() - 0.5) * 0.1);

        if (depth > 0.01) {
          totalFloodArea += 0.05; // km² per grid cell
          maxDepthValue = Math.max(maxDepthValue, depth);
          if (depth > 0.3) highRiskCount++;

          stepGrids.push({
            lat: Math.round(lat * 10000) / 10000,
            lng: Math.round(lng * 10000) / 10000,
            depth: Math.round(depth * 100) / 100,
          });
        }
      }
    }

    grids.push(stepGrids);
    timelines.push({
      time,
      floodArea: Math.round(totalFloodArea * 100) / 100,
      maxDepth: Math.round(maxDepthValue * 100) / 100,
    });
  }

  // Combine into result
  for (let step = 0; step <= steps; step++) {
    result.push({
      grids: grids[step],
      timelines: [timelines[step]],
    });
  }

  return result;
}

// Static display layers (GeoJSON-like definitions)
export const staticLayers = [
  { id: 'terrain', name: '地形高程', color: '#8B7355', visible: true },
  { id: 'pipes', name: '排水管网', color: '#2563eb', visible: true },
  { id: 'buildings', name: '建筑分布', color: '#94a3b8', visible: false },
  { id: 'roads', name: '道路网络', color: '#475569', visible: false },
  { id: 'waters', name: '水系分布', color: '#06b6d4', visible: true },
];

// Flood depth color scale
export function getFloodColor(depth: number): string {
  if (depth <= 0) return 'transparent';
  if (depth < 0.1) return 'rgba(147, 197, 253, 0.4)';  // very light blue
  if (depth < 0.2) return 'rgba(96, 165, 250, 0.5)';    // light blue
  if (depth < 0.3) return 'rgba(59, 130, 246, 0.6)';    // blue
  if (depth < 0.5) return 'rgba(37, 99, 235, 0.7)';     // dark blue
  if (depth < 0.8) return 'rgba(147, 51, 234, 0.7)';    // purple
  return 'rgba(220, 38, 38, 0.8)';                      // red (danger)
}

// Legend items
export const floodLegend = [
  { label: '< 0.1m', color: 'rgba(147, 197, 253, 0.6)' },
  { label: '0.1-0.2m', color: 'rgba(96, 165, 250, 0.6)' },
  { label: '0.2-0.3m', color: 'rgba(59, 130, 246, 0.6)' },
  { label: '0.3-0.5m', color: 'rgba(37, 99, 235, 0.7)' },
  { label: '0.5-0.8m', color: 'rgba(147, 51, 234, 0.7)' },
  { label: '> 0.8m', color: 'rgba(220, 38, 38, 0.8)' },
];

// Pre-computed simulation data for demo
export function computeSimulation(
  intensity: number,
  duration: number,
  timeStep: number = 5
) {
  return generateFloodGrids(intensity, duration, timeStep);
}
