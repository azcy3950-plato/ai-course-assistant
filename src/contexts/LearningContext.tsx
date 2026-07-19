'use client';

import React, { createContext, useContext, useReducer, ReactNode, useCallback } from 'react';
import { GuidedProgress, LearningRecord, RecordType } from '@/types';

interface LearningState {
  guidedProgress: GuidedProgress | null;
  records: LearningRecord[];
}

type LearningAction =
  | { type: 'START_GUIDED'; payload: GuidedProgress }
  | { type: 'UPDATE_GUIDED_PROGRESS'; payload: Partial<GuidedProgress> }
  | { type: 'COMPLETE_GUIDED' }
  | { type: 'ADD_RECORD'; payload: LearningRecord };

function learningReducer(state: LearningState, action: LearningAction): LearningState {
  switch (action.type) {
    case 'START_GUIDED':
      return { ...state, guidedProgress: action.payload };
    case 'UPDATE_GUIDED_PROGRESS':
      if (!state.guidedProgress) return state;
      return {
        ...state,
        guidedProgress: { ...state.guidedProgress, ...action.payload },
      };
    case 'COMPLETE_GUIDED':
      if (!state.guidedProgress) return state;
      return {
        ...state,
        guidedProgress: { ...state.guidedProgress, completed: true },
        records: [
          {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            type: 'guided' as RecordType,
            title: state.guidedProgress.scenarioTitle,
            summary: `完成引导学习 ${state.guidedProgress.currentStep}/${state.guidedProgress.totalSteps} 轮，使用提示 ${state.guidedProgress.hintsUsed} 次`,
            timestamp: Date.now(),
            duration: Math.floor((Date.now() - state.guidedProgress.startedAt) / 60000),
          },
          ...state.records,
        ],
      };
    case 'ADD_RECORD':
      return { ...state, records: [action.payload, ...state.records] };
    default:
      return state;
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

interface LearningContextValue {
  state: LearningState;
  startGuided: (scenarioId: string, scenarioTitle: string, totalSteps: number) => void;
  updateProgress: (updates: Partial<GuidedProgress>) => void;
  completeGuided: () => void;
  addRecord: (type: RecordType, title: string, summary: string) => void;
}

const LearningContext = createContext<LearningContextValue | null>(null);

export function LearningProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(learningReducer, {
    guidedProgress: null,
    records: [
      {
        id: 'rec-1',
        type: 'knowledge',
        title: '城市内涝成因查询',
        summary: '查询了城市内涝的主要成因，获取了排水系统设计标准和海绵城市相关资料',
        timestamp: Date.now() - 86400000,
        duration: 15,
      },
      {
        id: 'rec-2',
        type: 'sandbox',
        title: '内涝模拟实验',
        summary: '使用电子沙盘模拟了50mm/h降雨强度下的内涝情景，观察了积水变化过程',
        timestamp: Date.now() - 172800000,
        duration: 25,
      },
    ],
  });

  const startGuided = useCallback(
    (scenarioId: string, scenarioTitle: string, totalSteps: number) => {
      dispatch({
        type: 'START_GUIDED',
        payload: {
          scenarioId,
          scenarioTitle,
          currentStep: 1,
          totalSteps,
          hintsUsed: 0,
          maxHints: 3,
          completed: false,
          startedAt: Date.now(),
        },
      });
    },
    []
  );

  const updateProgress = useCallback((updates: Partial<GuidedProgress>) => {
    dispatch({ type: 'UPDATE_GUIDED_PROGRESS', payload: updates });
  }, []);

  const completeGuided = useCallback(() => {
    dispatch({ type: 'COMPLETE_GUIDED' });
  }, []);

  const addRecord = useCallback((type: RecordType, title: string, summary: string) => {
    dispatch({
      type: 'ADD_RECORD',
      payload: {
        id: generateId(),
        type,
        title,
        summary,
        timestamp: Date.now(),
      },
    });
  }, []);

  return (
    <LearningContext.Provider
      value={{ state, startGuided, updateProgress, completeGuided, addRecord }}
    >
      {children}
    </LearningContext.Provider>
  );
}

export function useLearning() {
  const ctx = useContext(LearningContext);
  if (!ctx) throw new Error('useLearning must be used within LearningProvider');
  return ctx;
}
