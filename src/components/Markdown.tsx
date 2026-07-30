import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const components: any = {
  h1: ({ children }: any) => <h1 className="text-xl font-bold mt-4 mb-2 text-[var(--color-text)]">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-lg font-bold mt-3 mb-2 text-[var(--color-text)]">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-base font-bold mt-2 mb-1 text-[var(--color-text)]">{children}</h3>,
  strong: ({ children }: any) => <strong className="font-bold text-[var(--color-primary)]">{children}</strong>,
  ul: ({ children }: any) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
  li: ({ children }: any) => <li className="text-sm">{children}</li>,
  p: ({ children }: any) => <p className="text-sm mb-1.5 leading-relaxed">{children}</p>,
  hr: () => <hr className="my-3 border-[var(--color-border)]" />,
  table: ({ children }: any) => <div className="overflow-x-auto"><table className="w-full border-collapse my-2 text-sm">{children}</table></div>,
  th: ({ children }: any) => <th className="bg-gray-50 p-2 text-left border border-[var(--color-border)] font-semibold text-xs">{children}</th>,
  td: ({ children }: any) => <td className="p-2 border border-[var(--color-border)] text-xs">{children}</td>,
  code: ({ children }: any) => <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
  pre: ({ children }: any) => <pre className="bg-gray-50 p-3 rounded-lg overflow-x-auto text-xs my-2">{children}</pre>,
};

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
