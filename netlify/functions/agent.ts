const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY!;
const DEEPSEEK_MODEL = "deepseek-chat";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callDeepSeek(messages: ChatMsg[], maxTokens = 2048) {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API 错误 (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "未登录" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const { action, params } = await req.json();
    let messages: ChatMsg[];

    // ══════════════ KNOWLEDGE AGENT ══════════════
    if (action === "knowledge") {
      const { question, context } = params;
      const contextBlock = context
        ? `\n\n以下是知识库中与用户问题相关的参考内容：\n\n${context}\n\n请根据以上参考内容回答用户的问题。如果参考内容不足，可以结合你自己的知识补充，但要注明哪些是来自知识库，哪些是你的知识。`
        : "";

      messages = [
        {
          role: "system",
          content: `你是「城市排水与内涝防治」课程的 AI 助教。你的职责是帮助学生理解城市排水系统、内涝防治、海绵城市等相关知识。你应该：\n- 用中文回答，语言清晰专业，条理分明\n- 引用知识库中的资料时标注来源\n- 对于复杂问题，提供结构化的回答\n- 鼓励学生深入思考，但不要离题${contextBlock}`,
        },
        { role: "user", content: question },
      ];

      const answer = await callDeepSeek(messages);
      return new Response(
        JSON.stringify({ answer, references: [] }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ══════════════ GUIDED — START ══════════════
    if (action === "guided_start") {
      const { scenarioTitle, scenarioDescription, firstQuestion, totalSteps } = params;
      messages = [
        {
          role: "system",
          content: "你是引导式学习 AI 助教。用中文回复，语气亲切鼓励，帮助学生进入学习状态。",
        },
        {
          role: "user",
          content: `学习场景「${scenarioTitle}」：${scenarioDescription}\n第一道问题：${firstQuestion}\n总共 ${totalSteps} 步。\n\n请生成一个简短的欢迎语，然后自然地引出第一个问题。直接说人话，不要JSON。`,
        },
      ];

      const text = await callDeepSeek(messages, 512);
      return new Response(
        JSON.stringify({ greeting: text, firstQuestion }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ══════════════ GUIDED — EVALUATE ══════════════
    if (action === "guided_evaluate") {
      const { scenarioTitle, stepNumber, totalSteps, question, expectedAnswer, studentAnswer } = params;
      messages = [
        {
          role: "system",
          content: `你是引导式学习 AI 助教。学生在学习「${scenarioTitle}」。你的任务是评价学生的回答。\n\n规则：\n- 以鼓励为主，肯定正确部分\n- 指出可以补充的地方，但不要直接否定\n- 给出知识点的完整解释\n- 如果学生回答很短（不到20字），鼓励他们展开思考\n\n用中文回复，输出JSON格式：\n{"feedback": "评价（1-2句）", "explanation": "完整知识讲解（2-5句）"}`,
        },
        {
          role: "user",
          content: `问题（第${stepNumber}/${totalSteps}步）：${question}\n${expectedAnswer ? `参考答案要点：${expectedAnswer}` : ""}\n\n学生回答：${studentAnswer}\n\n请评价。`,
        },
      ];

      const text = await callDeepSeek(messages, 1024);
      try {
        const parsed = JSON.parse(text);
        return new Response(JSON.stringify({
          feedback: parsed.feedback || "感谢你的回答！",
          explanation: parsed.explanation || text,
        }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      } catch {
        return new Response(JSON.stringify({
          feedback: text,
          explanation: text,
        }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
    }

    // ══════════════ GUIDED — HINT ══════════════
    if (action === "guided_hint") {
      const { question, hintsUsed } = params;
      messages = [
        {
          role: "system",
          content: `你是引导式学习 AI 助教。学生遇到困难需要提示。\n规则：\n- 第1次提示：给一个知识点方向\n- 第2次提示：给思路引导\n- 第3次提示：给具体步骤但不给答案\n- 第4次及以上：可以非常接近答案但不要直接说出来\n\n用中文，直接说人话。`,
        },
        {
          role: "user",
          content: `问题：${question}\n已使用 ${hintsUsed} 次提示。请给第 ${hintsUsed + 1} 级提示。`,
        },
      ];

      const text = await callDeepSeek(messages, 256);
      return new Response(
        JSON.stringify({ hint: text }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ══════════════ SANDBOX AGENT ══════════════
    if (action === "sandbox") {
      const { question, simulation } = params;
      messages = [
        {
          role: "system",
          content: "你是城市排水与内涝防治的 AI 专家。你需要根据模拟数据分析内涝情况，提出专业建议和具体改进方案。用中文回答，条理清晰。",
        },
        {
          role: "user",
          content: `当前模拟参数：\n- 降雨强度：${simulation?.intensity || "?"} mm/h\n- 降雨历时：${simulation?.duration || "?"} min\n- 最大积水深度：${simulation?.maxDepth || "?"} m\n- 积水面积：${simulation?.floodArea || "?"} km²\n\n用户问题：${question}`,
        },
      ];

      const text = await callDeepSeek(messages);
      return new Response(
        JSON.stringify({ answer: text, references: [] }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    return new Response(JSON.stringify({ error: `未知操作: ${action}` }), {
      status: 400,
      headers: corsHeaders,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "AI 服务错误" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
}
