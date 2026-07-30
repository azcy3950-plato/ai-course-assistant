"use client";

import React, { useState, useEffect } from "react";

interface Props {
  fileName: string;
  fileUrl: string;
  onClose: () => void;
}

export default function FilePreview({ fileName, fileUrl, onClose }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileUrl }),
        });
        if (res.ok) {
          const data = await res.json();
          setText(data.text || "(无法提取文字内容)");
        } else {
          setError("预览失败");
        }
      } catch (e) { setError("加载失败"); }
      finally { setLoading(false); }
    })();
  }, [fileUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h3 className="text-base font-bold truncate flex-1 mr-4">{fileName}</h3>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-[var(--color-text-muted)]">
              <span className="animate-spin mr-2">⏳</span> 提取文字中...
            </div>
          ) : error ? (
            <div className="text-center py-20 text-red-500">{error}</div>
          ) : (
            <div className="text-sm whitespace-pre-wrap leading-relaxed text-[var(--color-text)] max-h-[60vh] overflow-y-auto bg-gray-50 rounded-xl p-6">
              {text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
