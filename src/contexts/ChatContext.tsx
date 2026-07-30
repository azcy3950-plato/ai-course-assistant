'use client';

import React, { createContext, useContext, useReducer, ReactNode, useCallback, useEffect } from 'react';
import { Conversation, Message } from '@/types';

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
}

type ChatAction =
  | { type: 'CREATE_CONVERSATION'; payload: Conversation }
  | { type: 'SET_ACTIVE'; payload: string }
  | { type: 'ADD_MESSAGE'; payload: { conversationId: string; message: Message } }
  | { type: 'DELETE_CONVERSATION'; payload: string }
  | { type: 'UPDATE_TITLE'; payload: { id: string; title: string } }
  | { type: 'UPDATE_LAST_MESSAGE'; payload: { conversationId: string; content: string } };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'CREATE_CONVERSATION':
      return {
        ...state,
        conversations: [action.payload, ...state.conversations],
        activeConversationId: action.payload.id,
      };
    case 'SET_ACTIVE':
      return { ...state, activeConversationId: action.payload };
    case 'ADD_MESSAGE':
      return {
        ...state,
        conversations: state.conversations.map(c =>
          c.id === action.payload.conversationId
            ? {
                ...c,
                messages: [...c.messages, action.payload.message],
                updatedAt: Date.now(),
                title: c.messages.length === 0 && action.payload.message.role === 'user'
                  ? action.payload.message.content.slice(0, 30) + (action.payload.message.content.length > 30 ? '...' : '')
                  : c.title,
              }
            : c
        ),
      };
    case 'DELETE_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.filter(c => c.id !== action.payload),
        activeConversationId:
          state.activeConversationId === action.payload
            ? state.conversations.find(c => c.id !== action.payload)?.id ?? null
            : state.activeConversationId,
      };
    case 'UPDATE_TITLE':
      return {
        ...state,
        conversations: state.conversations.map(c =>
          c.id === action.payload.id ? { ...c, title: action.payload.title } : c
        ),
      };
    case 'UPDATE_LAST_MESSAGE':
      return {
        ...state,
        conversations: state.conversations.map(c => {
          if (c.id !== action.payload.conversationId) return c;
          const msgs = [...c.messages];
          if (msgs.length > 0) msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: action.payload.content };
          return { ...c, messages: msgs, updatedAt: Date.now() };
        }),
      };
    default:
      return state;
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

interface ChatContextValue {
  state: ChatState;
  createConversation: () => string;
  setActive: (id: string) => void;
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'timestamp'>) => void;
  deleteConversation: (id: string) => void;
  updateTitle: (id: string, title: string) => void;
  updateLastMessage: (conversationId: string, content: string) => void;
  getActiveConversation: () => Conversation | undefined;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const STORAGE_KEY = "aicourse-chat-v1";

function loadState(): { conversations: Conversation[]; activeConversationId: string | null } {
  if (typeof window === "undefined") return { conversations: [], activeConversationId: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { conversations: [], activeConversationId: null };
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, loadState());

  // Persist to localStorage
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }, [state]);

  const createConversation = useCallback(() => {
    const id = generateId();
    const conv: Conversation = {
      id,
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dispatch({ type: 'CREATE_CONVERSATION', payload: conv });
    return id;
  }, []);

  const setActive = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE', payload: id });
  }, []);

  const addMessage = useCallback(
    (conversationId: string, message: Omit<Message, 'id' | 'timestamp'>) => {
      const fullMessage: Message = {
        ...message,
        id: generateId(),
        timestamp: Date.now(),
      };
      dispatch({
        type: 'ADD_MESSAGE',
        payload: { conversationId, message: fullMessage },
      });
    },
    []
  );

  const deleteConversation = useCallback((id: string) => {
    dispatch({ type: 'DELETE_CONVERSATION', payload: id });
  }, []);

  const updateTitle = useCallback((id: string, title: string) => {
    dispatch({ type: 'UPDATE_TITLE', payload: { id, title } });
  }, []);

  const updateLastMessage = useCallback((conversationId: string, content: string) => {
    dispatch({ type: 'UPDATE_LAST_MESSAGE', payload: { conversationId, content } });
  }, []);

  const getActiveConversation = useCallback(() => {
    return state.conversations.find(c => c.id === state.activeConversationId);
  }, [state.conversations, state.activeConversationId]);

  return (
    <ChatContext.Provider
      value={{
        state,
        createConversation,
        setActive,
        addMessage,
        deleteConversation,
        updateTitle,
        updateLastMessage,
        getActiveConversation,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
