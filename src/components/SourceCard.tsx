'use client';

import React from 'react';
import { Reference } from '@/types';

interface Props {
  reference: Reference;
  isHighlighted?: boolean;
  onClick?: () => void;
}

export default function SourceCard({ reference, isHighlighted, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
        isHighlighted
          ? 'bg-yellow-50 border-yellow-300 shadow-sm reference-highlight'
          : 'bg-white border-[var(--color-border)] hover:border-[var(--color-primary-light)] hover:shadow-sm'
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-bold shrink-0">
          {reference.id}
        </span>
        <span className="text-xs font-medium text-[var(--color-text)] truncate">
          {reference.docName}
        </span>
      </div>
      <div className="text-[11px] text-[var(--color-text-secondary)] mb-1.5">
        {reference.chapter} · 第 {reference.page} 页
      </div>
      <div className="text-xs text-[var(--color-text-muted)] bg-gray-50 rounded p-2 line-clamp-3 leading-relaxed">
        &ldquo;{reference.snippet}&rdquo;
      </div>
    </button>
  );
}
