"use client";

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

export type CompanionSnapshot = {
  nodeId: string;
  nodeName: string;
  question: string;
  history: {role: 'user' | 'assistant'; content: string}[];
  learningEvent: {id: string; kind: 'question' | 'complete'} | null;
};
const emptySnapshot: CompanionSnapshot = {nodeId: '', nodeName: '', question: '', history: [], learningEvent: null};
const SnapshotContext = createContext(emptySnapshot);
const PublishContext = createContext<Dispatch<SetStateAction<CompanionSnapshot>>>(() => {});

/** React-only bridge: the workspace keeps its original DOM and controls. */
export function CompanionProvider({children}: {children: ReactNode}) {
  const [snapshot, publish] = useState(emptySnapshot);
  return <PublishContext.Provider value={publish}><SnapshotContext.Provider value={snapshot}>{children}</SnapshotContext.Provider></PublishContext.Provider>;
}
export const useCompanionSnapshot = () => useContext(SnapshotContext);
export const usePublishCompanion = () => useContext(PublishContext);
