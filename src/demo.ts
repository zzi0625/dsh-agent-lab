/**
 * demo.ts — 非交互演示入口
 * 不依赖终端交互，直接跑一条提问并打印工具轨迹，便于冒烟测试和留档截图。
 * 用法：npx ts-node src/demo.ts "你的问题"
 */

import { Agent } from "./agents";
import type { LoopEvent } from "./agent-loop";

function renderEvent(event: LoopEvent): void {
  if (event.type === "tool") {
    console.log(`  ● ${event.name} ${JSON.stringify(event.args)} - ${event.elapsedMs} ms`);
  } else if (event.type === "final") {
    console.log(`\n${event.content}\n`);
  }
}

async function main(): Promise<void> {
  const prompt = process.argv[2] ?? "帮我查一下 Python 是什么";
  const agent = new Agent({ onEvent: renderEvent });
  const session = await agent.run(prompt);
  const file = session.dump("logs");
  console.log(`[会话已落盘] ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
