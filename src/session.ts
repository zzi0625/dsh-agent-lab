/**
 * session.ts — Session Log（会话状态）
 * 保存一条任务的全部消息，是 Agent 循环的“唯一事实来源”：
 * 每一轮把模型回复和工具结果 append 进来，下一轮再整体喂回模型。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatMessage } from "./llm";

export class Session {
  readonly id: string;
  private messages: ChatMessage[] = [];

  constructor(id = `sess_${Date.now()}`) {
    this.id = id;
  }

  /** 追加一条消息，返回 this 以便链式调用 */
  push(message: ChatMessage): this {
    this.messages.push(message);
    return this;
  }

  history(): readonly ChatMessage[] {
    return this.messages;
  }

  length(): number {
    return this.messages.length;
  }

  /** 把整段会话落盘，便于复盘与后续做数据集 */
  dump(dir = "logs"): string {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${this.id}.json`);
    writeFileSync(file, JSON.stringify(this.messages, null, 2), "utf8");
    return file;
  }
}
