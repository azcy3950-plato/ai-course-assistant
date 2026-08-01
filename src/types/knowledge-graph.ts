export type KnowledgeRelationType =
  | "prerequisite"
  | "leads_to"
  | "related"
  | "applied_in"
  | "governed_by";

export type KnowledgeResourceType = "ppt" | "textbook" | "case" | "reference";

export type KnowledgeNodeCategory = "core" | "method" | "goal" | "factor" | "benefit";

export interface KnowledgeGraphSource {
  id: string;
  title: string;
  url: string;
  syncedAt?: string;
}

export interface KnowledgeResource {
  id: string;
  nodeId: string;
  type: KnowledgeResourceType;
  title: string;
  docName: string;
  chapter: string;
  page?: number;
  url?: string;
  snippet?: string;
}

export interface StudentNodeProgress {
  nodeId: string;
  questionCount: number;
  studyCount: number;
  quizCorrect: number;
  quizTotal: number;
  quizAccuracy: number;
  lastStudiedAt?: string;
  mastery: number;
}

export interface KnowledgeNode {
  id: string;
  name: string;
  description: string;
  chapter: string;
  keywords: string[];
  category: KnowledgeNodeCategory;
  color?: string;
  imageUrl?: string;
  sourceUrl?: string;
  resources: KnowledgeResource[];
  progress?: StudentNodeProgress;
}

export interface KnowledgeEdge {
  id: string;
  source: string;
  target: string;
  relation: KnowledgeRelationType;
  label: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  source?: KnowledgeGraphSource;
}

export interface GraphMatchSignals {
  keywordScore: number;
  embeddingScore: number;
  documentScore: number;
  combinedScore: number;
}

export interface GraphContext {
  focusNode: KnowledgeNode;
  prerequisites: KnowledgeNode[];
  relatedNodes: KnowledgeNode[];
  nextNodes: KnowledgeNode[];
  highlightNodeIds: string[];
  highlightEdges: string[];
  suggestedNextNode?: KnowledgeNode;
  matchSignals?: GraphMatchSignals;
}

export interface KnowledgeGraphResponse {
  graph: KnowledgeGraph;
  suggestedPath: string[];
  graphContext?: GraphContext;
}

export type KnowledgeNodeAction =
  | "explain"
  | "learn_prerequisite"
  | "learn_next"
  | "practice"
  | "resources";
