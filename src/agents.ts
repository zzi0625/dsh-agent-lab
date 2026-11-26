/**
 * agents.ts — Agent 装配层
 * 把 llm（决策）、session（状态）、registry（工具）、agent-loop（循环）组装成
 * 一个可复用的 Agent 对象；后续接真实模型或加插件，只需替换 / 扩展对应实现。
 */

import { runAgentLoop, type LoopEvent, type LoopOptions } from "./agent-loop";
import { createLlm, type Llm } from "./llm";
import { Session } from "./session";
import { createDefaultRegistry } from "./plugins/preset";
import type { ToolRegistry } from "./plugins/registry";

export interface AgentOptions {
  llm?: Llm;
  registry?: ToolRegistry;
  sessionId?: string;
  maxSteps?: number;
  onEvent?: (event: LoopEvent) => void;
}

export class Agent {
  readonly llm: Llm;
  readonly session: Session;
  readonly registry: ToolRegistry;
  private readonly loopOptions: LoopOptions;

  constructor(options: AgentOptions = {}) {
    this.llm = options.llm ?? createLlm();
    this.registry = options.registry ?? createDefaultRegistry();
    this.session = new Session(options.sessionId);
    this.loopOptions = { maxSteps: options.maxSteps, onEvent: options.onEvent };
  }

  /** 接收一条用户指令，跑完整调度闭环，返回本次会话 */
  run(prompt: string): Promise<Session> {
    return runAgentLoop(this.llm, this.session, prompt, this.registry, this.loopOptions);
  }
}
