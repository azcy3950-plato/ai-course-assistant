// ═══════════════════════════════════════════════════════════
// Sandbox TypeScript Types
// ═══════════════════════════════════════════════════════════

export interface Node3D {
  id: string; x: number; z: number;
  invert: number; maxD: number; initD: number;
  ground: number; type: 'junction' | 'outfall' | 'storage';
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

export interface ParsedData {
  nodes: Node3D[]; pipes: Pipe3D[]; scs: SC3D[]; outfallIds: Set<string>;
}

export type SandboxMode = 'static' | 'dynamic';
export type DynPhase = 'config' | 'loading' | 'ready' | 'running' | 'paused' | 'done';
export type ViewPreset = 'panorama' | 'topdown' | 'underground';

export interface NodeTimeSeries {
  depth: number[]; totalInflow: number[]; pondedVolume: number[]; floodingLosses: number[];
}

export interface LinkTimeSeries {
  flow: number[]; depth: number[]; velocity: number[]; volume: number[]; capacity: number[]; depthFraction: number[];
}

export interface SimulationResult {
  ok: boolean;
  simulationId: string;
  status: string;
  parameters: { intensity: number };
  timeStepCount: number;
  timestamps: number[];
  metadata: { startTime: string; endTime: string; flowUnits: string };
  nodes: Record<string, NodeTimeSeries>;
  links: Record<string, LinkTimeSeries>;
  summary: {
    maxDepth: { value: number; nodeId: string | null; timestamp: number | null };
    maxFlow: { value: number; linkId: string | null; timestamp: number | null; signedValue: number; direction: string | null };
    totalNodes: number; totalLinks: number; activeNodes: number; activeLinks: number;
  };
}

export interface LayerState {
  sc: boolean; pipes: boolean; nodes: boolean; ground: boolean; labels: boolean;
}

export interface SelectedObject {
  type: 'node' | 'pipe' | 'subcatchment';
  data: Record<string, any>;
}

export interface CameraState {
  theta: number; phi: number; dist: number; tx: number; tz: number;
}
