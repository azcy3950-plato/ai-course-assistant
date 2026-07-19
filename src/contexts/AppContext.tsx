'use client';

import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { AppState, UserRole } from '@/types';

type AppAction =
  | { type: 'SET_ROLE'; payload: UserRole }
  | { type: 'SET_USER_NAME'; payload: string };

const initialState: AppState = {
  role: 'student',
  userName: '张同学',
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_ROLE':
      return {
        ...state,
        role: action.payload,
        userName: action.payload === 'student' ? '张同学' : '李老师',
      };
    case 'SET_USER_NAME':
      return { ...state, userName: action.payload };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
