'use client';

import React, { createContext, useContext, useReducer, ReactNode, useCallback } from 'react';
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
  | { type: 'UPDATE_TITLE'; payload: { id: string; title: string } };

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
  getActiveConversation: () => Conversation | undefined;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, {
    conversations: [],
    activeConversationId: null,
  });

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
