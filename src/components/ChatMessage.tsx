'use client';

import React from 'react';
import { Message, Reference } from '@/types';
import Markdown from './Markdown';

interface Props {
  message: Message;
  onReferenceClick?: (refId: number) => void;
  highlightedRef?: number | null;
  onRegenerate?: () => void;
}

export default function ChatMessage({ message, onReferenceClick, highlightedRef, onRegenerate }: Props) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(message.content); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  // Render content with clickable reference markers [1], [2], etc.
  const renderContent = (content: string) => {
    const parts = content.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (match) {
        const refId = parseInt(match[1]);
        const isHighlighted = highlightedRef === refId;
        return (
          <button
            key={i}
            onClick={() => onReferenceClick?.(refId)}
            className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mx-0.5 align-middle transition-all cursor-pointer border-0 ${
              isHighlighted
                ? 'bg-yellow-400 text-yellow-900 scale-125 ring-2 ring-yellow-300'
                : 'bg-[var(--color-primary-bg)] text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white'
            }`}
            title={`查看引用来源 [${refId}]`}
          >
            {refId}
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className={`flex gap-3 py-4 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm ${
          isUser
            ? 'bg-[var(--color-primary)] text-white'
            : 'bg-[var(--color-accent)] text-white'
        }`}
      >
        {isUser ? 'U' : 'AI'}
      </div>

      {/* Content */}
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 message-content ${
          isUser
            ? 'bg-[var(--color-primary)] text-white'
            : 'bg-white border border-[var(--color-border)] text-[var(--color-text)]'
        }`}
      >
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {isUser ? <span className="whitespace-pre-wrap">{message.content}</span> : <Markdown text={message.content} />}
        </div>

        {/* References list inline */}
        {!isUser && message.references && message.references.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
            <div className="text-xs text-[var(--color-text-muted)] mb-1.5 font-medium">
              📖 引用来源
            </div>
            <div className="space-y-1">
              {message.references.map(ref => (
                <button
                  key={ref.id}
                  onClick={() => onReferenceClick?.(ref.id)}
                  className={`block w-full text-left text-xs p-1.5 rounded transition-colors ${
                    highlightedRef === ref.id
                      ? 'bg-yellow-100 ring-1 ring-yellow-300'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="font-medium text-[var(--color-primary)]">[{ref.id}]</span>{' '}
                  <span className="text-[var(--color-text-secondary)]">
                    {ref.docName}{ref.chapter ? ` · ${ref.chapter}` : ''}{ref.page ? ` · 第${ref.page}页` : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actions row */}
        {!isUser && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--color-border)]">
            <button onClick={handleCopy} className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors flex items-center gap-1">
              {copied ? '✅ 已复制' : '📋 复制'}
            </button>
            {onRegenerate && (
              <button onClick={onRegenerate} className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors flex items-center gap-1">🔄 重新生成</button>
            )}
            <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">{message.content.length} 字</span>
          </div>
        )}
        {/* Timestamp */}
        <div className={`text-[10px] mt-1 ${isUser ? 'text-white/70' : 'text-[var(--color-text-muted)]'}`}>
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
