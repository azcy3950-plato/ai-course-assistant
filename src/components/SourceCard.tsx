"use client";

import React from "react";
import { Reference } from "@/types";

interface Props {
  reference: Reference;
  isHighlighted?: boolean;
  onClick?: () => void;
}

export default function SourceCard({ reference, isHighlighted, onClick }: Props) {
  const content = (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-primary)] text-white text-[10px] font-bold shrink-0">
          {reference.id}
        </span>
        <span className="text-xs font-medium text-[var(--color-text)] truncate">
          {reference.docName}
        </span>
        {reference.fileUrl && (
          <svg className="w-3 h-3 text-[var(--color-primary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        )}
      </div>
      <div className="text-[11px] text-[var(--color-text-secondary)] mb-1.5">
        {reference.chapter}
        {reference.page > 0 ? " 第 " + reference.page + " 页" : ""}
        {reference.fileUrl ? "  🔗 点击查看源文件" : ""}
      </div>
      <div className="text-xs text-[var(--color-text-muted)] bg-gray-50 rounded p-2 line-clamp-3 leading-relaxed">
        &ldquo;{reference.snippet}&rdquo;
      </div>
    </>
  );

  const cardClass = `w-full text-left p-3 rounded-lg border transition-all ${
    isHighlighted
      ? "bg-yellow-50 border-yellow-300 shadow-sm"
      : `bg-white border-[var(--color-border)] hover:border-[var(--color-primary-light)] hover:shadow-sm ${
          reference.fileUrl ? "cursor-pointer hover:bg-blue-50" : ""
        }`
  }`;

  if (reference.fileUrl) {
    return (
      <a
        href={reference.fileUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          if (onClick) {
            e.preventDefault();
            onClick();
          }
        }}
        className={cardClass}
      >
        {content}
      </a>
    );
  }

  return (
    <div onClick={onClick} className={cardClass}>
      {content}
    </div>
  );
}
