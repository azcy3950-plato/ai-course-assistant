"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

let toastId = 0;

interface ToastContextValue {
  toast: (message: string, type?: "success" | "error" | "info") => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    const id = ++toastId;
    setItems(prev => [...prev, { id, message, type }]);
    setTimeout(() => setItems(prev => prev.filter(i => i.id !== id)), 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] space-y-2 pointer-events-none">
        {items.map(item => (
          <div
            key={item.id}
            className={"px-5 py-3 rounded-xl shadow-lg text-sm font-medium pointer-events-auto animate-bounce " +
              (item.type === "success" ? "bg-green-500 text-white" :
               item.type === "error" ? "bg-red-500 text-white" : "bg-gray-800 text-white")}
          >
            {item.type === "success" ? "✅ " : item.type === "error" ? "❌ " : "ℹ️ "}
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
