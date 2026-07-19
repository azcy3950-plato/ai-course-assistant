// ========== User & Role ==========
export type UserRole = 'student' | 'teacher';

export interface User {
  name: string;
  role: UserRole;
}

export interface AppState {
  role: UserRole | null;
  userName: string | null;
  authLoading: boolean;
}

// ========== Chat & Messages ==========
export interface Reference {
  id: number;
  docName: string;
  chapter: string;
  page: number;
  snippet: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  references?: Reference[];
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

// ========== Guided Learning ==========
export interface GuidedStep {
  step: number;
  totalSteps: number;
  question: string;
  expectedAnswer?: string;
  hints: string[];          // [知识点提示, 思路提示, 步骤提示]
  explanation: string;
}

export interface GuidedProgress {
  scenarioId: string;
  scenarioTitle: string;
  currentStep: number;
  totalSteps: number;
  hintsUsed: number;
  maxHints: number;
  completed: boolean;
  startedAt: number;
}

// ========== Sandbox ==========
export type SandboxMode = 'static' | 'dynamic';

export interface SandboxLayer {
  id: string;
  name: string;
  visible: boolean;
  color: string;
}

export interface SandboxParams {
  mode: SandboxMode;
  layers: SandboxLayer[];
  rainfallIntensity: number;  // mm/h
  rainfallDuration: number;   // min
  returnPeriod: number;       // years
}

export interface SimulationResult {
  timestamp: number;       // simulation time
  floodArea: number;       // km²
  maxDepth: number;        // m
  highRiskZones: number;   // count
  gridData: FloodGrid[];   // grid cells with flood depth
}

export interface FloodGrid {
  lat: number;
  lng: number;
  depth: number;  // m
}

export interface SimulationTimeline {
  time: number;     // minutes from start
  floodArea: number;
  maxDepth: number;
}

// ========== Learning Records ==========
export type RecordType = 'knowledge' | 'guided' | 'sandbox';

export interface LearningRecord {
  id: string;
  type: RecordType;
  title: string;
  summary: string;
  timestamp: number;
  duration?: number;  // minutes
}

// ========== Teacher ==========
export interface UploadedDocument {
  id: string;
  name: string;
  type: 'pdf' | 'ppt' | 'docx' | 'image' | 'other';
  size: number;
  uploadDate: number;
  chunks: number;
  status: 'processing' | 'ready' | 'error';
}

export interface StudentStats {
  id: string;
  name: string;
  totalSessions: number;
  knowledgeQueries: number;
  guidedCompleted: number;
  sandboxSessions: number;
  lastActive: number;
}

// ========== Agent ==========
export interface AgentResponse {
  answer: string;
  references?: Reference[];
  metadata?: Record<string, unknown>;
}
