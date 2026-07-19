'use client';

import React, { useState } from 'react';

interface Props {
  onHint: () => Promise<string>;
  hintsUsed: number;
  maxHints: number;
  disabled?: boolean;
}

export default function HintButton({ onHint, hintsUsed, maxHints, disabled }: Props) {
  const [loading, setLoading] = useState(false);
  const remaining = maxHints - hintsUsed;

  const handleClick = async () => {
    setLoading(true);
    try {
      await onHint();
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || remaining <= 0 || loading}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        remaining > 0 && !disabled
          ? 'bg-amber-50 text-amber-700 border border-amber-300 hover:bg-amber-100'
          : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
      }`}
      title={
        remaining <= 0
          ? '提示次数已用完'
          : `获取提示（剩余 ${remaining} 次）`
      }
    >
      {loading ? (
        <>
          <span className="animate-spin">⏳</span>
          加载中...
        </>
      ) : (
        <>
          <span>💡</span>
          给我提示
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-700">
            {remaining}/{maxHints}
          </span>
        </>
      )}
    </button>
  );
}
