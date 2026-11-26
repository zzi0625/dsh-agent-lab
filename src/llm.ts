/**
 * llm.ts — Model Seam（模型接缝）
 * 把“模型能力”抽象成 Llm 接口：Agent 只依赖接口，不依赖任何厂商 SDK。
 * 提供两种实现：
 *  - DeepSeekLlm：真实模型，走 OpenAI 兼容的 /chat/completions 接口，支持工具调用；
 *  - StubLlm：离线脚本模型，按固定轮次模拟“先搜索、再总结”，没有密钥也能跑通闭环。
 */

import { loadEnvFile } from "./env";

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: Role;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface LlmReply {
  content: string;
  tool_calls?: ToolCall[];
}

/** 对外公布给模型的工具定义（名称 + 描述 + 参数 schema） */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Llm {
  /** 传入完整会话历史与可用工具定义，返回本轮模型回复（可能带工具调用） */
  chat(messages: readonly ChatMessage[], tools: readonly ToolDefinition[]): Promise<LlmReply>;
}

// ---------------------------------------------------------------------------
// 真实模型：DeepSeek（OpenAI 兼容协议）
// ---------------------------------------------------------------------------

export interface DeepSeekOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export class DeepSeekLlm implements Llm {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: DeepSeekOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.model = options.model ?? "deepseek-flash";
  }

  async chat(messages: readonly ChatMessage[], tools: readonly ToolDefinition[]): Promise<LlmReply> {
    // 把内部消息结构翻译成 OpenAI / DeepSeek 接口要求的格式
    const body = {
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls
          ? {
              tool_calls: m.tool_calls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.args ?? {}),
                },
              })),
            }
          : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      })),
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: "auto",
      stream: false,
    };

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`DeepSeek 接口返回 ${resp.status}: ${text.slice(0, 300)}`);
    }

    const data = (await resp.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };

    const message = data.choices?.[0]?.message;
    const content = message?.content ?? "";

    const tool_calls: ToolCall[] = (message?.tool_calls ?? [])
      .filter((tc) => tc.function?.name)
      .map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          args = { raw: tc.function?.arguments };
        }
        return { id: tc.id, name: tc.function!.name!, args };
      });

    return { content, tool_calls: tool_calls.length > 0 ? tool_calls : undefined };
  }
}

// ---------------------------------------------------------------------------
// 离线脚本模型：没有密钥时用它跑通演示闭环
// ---------------------------------------------------------------------------

export class StubLlm implements Llm {
  private step = 0;

  async chat(messages: readonly ChatMessage[]): Promise<LlmReply> {
    const userPrompt = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const script: LlmReply[] = [
      {
        content: "[Stub 模型] 先联网搜索一下这个问题",
        tool_calls: [
          { id: "call_001", name: "web-search", args: { query: userPrompt, count: 5 } },
        ],
      },
      {
        content: "[Stub 模型] 搜索结果已经拿到，整理成最终答复。",
      },
    ];
    const reply = script[Math.min(this.step, script.length - 1)];
    this.step++;
    return reply;
  }
}

/**
 * 按环境变量自动选择模型：
 * 检测到 DEEPSEEK_API_KEY 就用真实模型，否则退回离线 Stub。
 */
export function createLlm(): Llm {
  loadEnvFile();
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (apiKey) {
    return new DeepSeekLlm({
      apiKey,
      baseUrl: process.env.DEEPSEEK_BASE_URL,
      model: process.env.DEEPSEEK_MODEL,
    });
  }
  return new StubLlm();
}
