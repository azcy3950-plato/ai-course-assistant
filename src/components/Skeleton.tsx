"use client";
import React from "react";

export function CardSkeleton() {
  return <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 animate-pulse"><div className="h-4 bg-gray-200 rounded w-3/4 mb-4" /><div className="h-8 bg-gray-200 rounded w-1/2" /></div>;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-xl border border-[var(--color-border)] overflow-hidden animate-pulse">
      <div className="px-5 py-3 border-b"><div className="h-4 bg-gray-200 rounded w-1/4" /></div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-5 py-3.5 border-b flex gap-4"><div className="h-4 bg-gray-200 rounded flex-1" /><div className="h-4 bg-gray-200 rounded w-20" /><div className="h-4 bg-gray-200 rounded w-16" /></div>
      ))}
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div className="space-y-4 animate-pulse p-4">
      <div className="flex gap-3"><div className="w-8 h-8 bg-gray-200 rounded-full shrink-0" /><div className="h-16 bg-gray-200 rounded-2xl flex-1 max-w-[75%]" /></div>
      <div className="flex gap-3 flex-row-reverse"><div className="w-8 h-8 bg-gray-200 rounded-full shrink-0" /><div className="h-10 bg-gray-200 rounded-2xl flex-1 max-w-[60%]" /></div>
      <div className="flex gap-3"><div className="w-8 h-8 bg-gray-200 rounded-full shrink-0" /><div className="h-24 bg-gray-200 rounded-2xl flex-1 max-w-[75%]" /></div>
    </div>
  );
}
