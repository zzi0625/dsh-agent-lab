/**
 * agent-loop.ts — 最小 Core 循环（dsh core 的心脏）
 * 模型推理 → 解析 tool_calls → 注册表执行工具 → 结果回填 Session → 再推理，
 * 直到模型不再请求工具（或触发 maxSteps 保护）。
 */

import type { Llm, ToolDefinition } from "./llm";
import type { Session } from "./session";
import type { ToolRegistry } from "./plugins/registry";

const SYSTEM_PROMPT =
  "你是 dsh 里的自动化爬虫 agent。需要联网查资料时调用 web-search；" +
  "拿到具体链接后调用 web-fetch 读取页面正文；拿到足够信息后给出最终答复。";

export type LoopEvent =
  | { type: "model"; step: number; content: string }
  | {
      type: "tool";
      step: number;
      name: string;
      args: Record<string, unknown>;
      result: string;
      elapsedMs: number;
    }
  | { type: "final"; step: number; content: string };

export interface LoopOptions {
  maxSteps?: number;
  onEvent?: (event: LoopEvent) => void;
}

export async function runAgentLoop(
  llm: Llm,
  session: Session,
  prompt: string,
  registry: ToolRegistry,
  options: LoopOptions = {},
): Promise<Session> {
  const { maxSteps = 8, onEvent = () => {} } = options;

  session
    .push({ role: "system", content: SYSTEM_PROMPT })
    .push({ role: "user", content: prompt });

  const toolDefs: ToolDefinition[] = registry.toolDefinitions();

  for (let step = 1; step <= maxSteps; step++) {
    // 1) 推理：把完整历史 + 可用工具定义交给模型
    const reply = await llm.chat(session.history(), toolDefs);
    session.push({ role: "assistant", content: reply.content, tool_calls: reply.tool_calls });
    onEvent({ type: "model", step, content: reply.content });

    const calls = reply.tool_calls ?? [];

    // 2) 收敛条件：没有工具调用 = 模型给出最终答复
    if (calls.length === 0) {
      onEvent({ type: "final", step, content: reply.content });
      return session;
    }

    // 3) 执行：逐个工具调用落地，结果作为 tool 消息回填历史
    for (const call of calls) {
      const started = Date.now();
      const result = await registry.dispatch(call);
      const elapsedMs = Date.now() - started;
      session.push({ role: "tool", content: result, tool_call_id: call.id });
      onEvent({ type: "tool", step, name: call.name, args: call.args, result, elapsedMs });
    }
  }

  throw new Error(`超过最大循环步数 ${maxSteps}，已强制中止`);
}
