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
// 真实模型：Anthropic Messages 协议（兼容中转站 /v1/messages，原生 tool_use 工具调用）
// ---------------------------------------------------------------------------

export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export class AnthropicLlm implements Llm {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: AnthropicOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:3000/v1").replace(/\/$/, "");
    this.model = options.model ?? "glm-5.3-flash";
  }

  async chat(messages: readonly ChatMessage[], tools: readonly ToolDefinition[]): Promise<LlmReply> {
    // system 消息在 Anthropic 协议里是顶层参数，不进 messages 数组
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");

    const anthMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (m.role === "tool") {
          return {
            role: "user" as const,
            content: [
              { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content },
            ],
          };
        }
        if (m.role === "assistant") {
          const blocks: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];
          if (m.content) blocks.push({ type: "text", text: m.content });
          for (const tc of m.tool_calls ?? []) {
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.args ?? {},
            });
          }
          return { role: "assistant" as const, content: blocks };
        }
        return { role: "user" as const, content: m.content };
      });

    const body = {
      model: this.model,
      max_tokens: 4096,
      ...(system ? { system } : {}),
      messages: anthMessages,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
      stream: false,
    };

    const resp = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        Authorization: `Bearer ${this.apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Anthropic 接口返回 ${resp.status}: ${text.slice(0, 300)}`);
    }

    const data = (await resp.json()) as {
      content?: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
    };

    const blocks = data.content ?? [];
    const content = blocks
      .filter((b): b is AnthropicTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const tool_calls: ToolCall[] = blocks
      .filter((b): b is AnthropicToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }));

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
 * 检测到 LLM_API_KEY（兼容旧名 DEEPSEEK_API_KEY）就用真实模型，否则退回离线 Stub。
 * 协议由 LLM_PROTOCOL 选择：anthropic（默认走 /v1/messages，原生 tool_use）或 openai（/chat/completions）。
 * 接入任意兼容中转都只改环境变量，不动代码。
 */
export function createLlm(): Llm {
  loadEnvFile();
  const apiKey = process.env.LLM_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (apiKey) {
    const protocol = (process.env.LLM_PROTOCOL ?? "openai").toLowerCase();
    const options = {
      apiKey,
      baseUrl: process.env.LLM_BASE_URL ?? process.env.DEEPSEEK_BASE_URL,
      model: process.env.LLM_MODEL ?? process.env.DEEPSEEK_MODEL,
    };
    return protocol === "anthropic" ? new AnthropicLlm(options) : new DeepSeekLlm(options);
  }
  return new StubLlm();
}
