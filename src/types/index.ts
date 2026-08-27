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
  fileUrl?: string;
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

// ========== 学习任务（教师布置 / 学生完成） ==========
export type TaskType = 'KNOWLEDGE' | 'PRACTICE' | 'GUIDED' | 'SIMULATION' | 'REMEDIAL';
export type StudentTaskStatus = 'TODO' | 'IN_PROGRESS' | 'SUBMITTED' | 'REVISION_REQUIRED' | 'COMPLETED';
export type EffectiveTaskStatus = StudentTaskStatus | 'OVERDUE';

export interface PracticeQuestion {
  q: string;
  options: string[];
  answer?: string;     // 正确选项；学生视角由服务端遮罩
  explanation?: string;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  type: TaskType;
  teacher_email: string;
  class_id: number | null;
  class_name?: string;
  target_emails: string[];
  knowledge_node_ids: string[];
  questions: PracticeQuestion[];
  observe_items: string[];
  prompt_questions: string[];
  deadline: string | null;
  created_at: string;
}

export interface StudentTaskItem extends Task {
  status: StudentTaskStatus;
  effective_status: EffectiveTaskStatus;
  started_at: string | null;
  completed_at: string | null;
  feedback_content?: string | null;
  feedback_status?: 'passed' | 'revision_required' | null;
  feedback_at?: string | null;
}

export interface TaskSubmission {
  id: number;
  task_id: number;
  user_email: string;
  version: number;
  judgment: string;
  explanation: string;
  reflection: string;
  answers: any[];
  status: 'pending' | 'passed' | 'revision_required';
  submitted_at: string;
  feedback_content?: string | null;
  feedback_status?: 'passed' | 'revision_required' | null;
  feedback_at?: string | null;
  student_name?: string;
}

export interface TeacherFeedbackItem {
  id: number;
  content: string;
  status: 'passed' | 'revision_required';
  created_at: string;
  task_id: number;
  task_title: string;
  task_type: TaskType;
  submission_version: number;
}

export interface LearningEvent {
  id: number;
  user_email: string;
  type: string;
  title: string;
  summary: string;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
}

export interface QaMessage {
  id: number;
  user_email: string;
  question: string;
  answer: string;
  references_data: any[];
  created_at: string;
  feedback_count: number;
  latest_version: number | null;
}

// ========== Agent ==========
export type {
  GraphContext,
  GraphMatchSignals,
  KnowledgeEdge,
  KnowledgeGraph,
  KnowledgeGraphResponse,
  KnowledgeGraphSource,
  KnowledgeNode,
  KnowledgeNodeAction,
  KnowledgeNodeCategory,
  KnowledgeRelationType,
  KnowledgeResource,
  KnowledgeResourceType,
  StudentNodeProgress,
} from './knowledge-graph';

import type { GraphContext } from './knowledge-graph';

export interface AgentResponse {
  answer: string;
  references?: Reference[];
  graphContext?: GraphContext;
  metadata?: Record<string, unknown>;
  domain?: string;
}
