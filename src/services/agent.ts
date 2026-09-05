import type { AgentResponse, GraphContext, Reference } from "@/types";

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("aicourse-token") || "";
}

export async function queryKnowledgeAgentStream(
  question: string,
  onChunk: (text: string) => void,
  onRefs?: (refs: Reference[]) => void,
  onGraphContext?: (context: GraphContext) => void,
): Promise<AgentResponse> {
  const token = getToken();
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "knowledge_stream", params: { question } }),
  });
  if (!res.ok || !res.body) throw new Error("Stream failed");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let refs: Reference[] = [];
  let graphContext: GraphContext | undefined;
  let domain: string | undefined;
  let buffer = "";
  let metadataRead = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (!metadataRead) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) continue;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      metadataRead = true;
      try {
        if (line.startsWith("__META__")) {
          const metadata = JSON.parse(line.slice(8));
          refs = mapReferences(metadata.references || []);
          graphContext = metadata.graphContext;
          domain = metadata.domain;
          onRefs?.(refs);
          if (graphContext) onGraphContext?.(graphContext);
        } else if (line.startsWith("__REFS__")) {
          refs = mapReferences(JSON.parse(line.slice(8)));
          onRefs?.(refs);
        } else {
          buffer = `${line}\n${buffer}`;
        }
      } catch {
        // A malformed metadata header should not discard the answer stream.
      }
    }
    fullText += buffer;
    buffer = "";
    onChunk(fullText);
  }
  fullText += decoder.decode();
  return { answer: fullText, references: refs, graphContext, domain };
}

function mapReferences(rawReferences: any[]): Reference[] {
  return rawReferences.map((reference) => ({
    id: reference.id,
    docName: reference.docName,
    chapter: reference.chapter || "",
    snippet: reference.content || reference.snippet || "",
    page: Number(reference.page || 0),
    fileUrl: reference.fileUrl || "",
  }));
}

const AGENT_API = "/api/agent";

async function getAuthHeaders() {
  return { "Content-Type": "application/json", Authorization: "Bearer " + getToken() };
}

async function callAgent(action: string, params: Record<string, any>) {
  const headers = await getAuthHeaders();
  const res = await fetch(AGENT_API, { method: "POST", headers, body: JSON.stringify({ action, params }) });
  if (!res.ok) throw new Error("AI服务错误");
  return res.json();
}

export async function queryKnowledgeAgent(question: string): Promise<AgentResponse> {
  try {
    const result = await callAgent("knowledge", { question });
    return {
      answer: result.answer,
      references: mapReferences(result.references || []),
      graphContext: result.graphContext,
    };
  } catch {
    return { answer: "抱歉，AI服务暂时不可用，请稍后再试。", references: [] };
  }
}
