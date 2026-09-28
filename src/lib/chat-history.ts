// 对话历史清洗:只保留 user/assistant 角色,防止客户端注入 system 消息
export function sanitizeHistory(raw: Array<{ role?: string; content?: string }>): Array<{ role: "user" | "assistant"; content: string }> {
  return (raw || [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role as "user" | "assistant", content: String(message.content || "").trim() }))
    .filter((message) => message.content.length > 0);
}
