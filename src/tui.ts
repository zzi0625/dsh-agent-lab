/**
 * tui.ts — 命令行交互入口（实验四交付的 TUI）
 * 启动后在终端里输入问题，Agent 自动调用 web-search / web-fetch，
 * 过程以工具轨迹逐条打印，最后给出模型答复。
 */

import readline from "node:readline";
import { Agent } from "./agents";
import type { LoopEvent } from "./agent-loop";
import { loadEnvFile } from "./env";

const BANNER = [
  "DDDD  SSSS  H   H",
  "D  D  S     H   H",
  "D  D  SSS   HHHHH",
  "D  D     S  H   H",
  "DDDD  SSSS  H   H",
  "",
  "agent-harness",
  "/help 帮助 · Esc 取消 · Ctrl+C 取消",
].join("\n");

const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

function renderEvent(event: LoopEvent): void {
  if (event.type === "tool") {
    const args = JSON.stringify(event.args);
    console.log(`  ${GREEN}●${RESET} ${event.name} ${args} - ${event.elapsedMs} ms`);
  } else if (event.type === "final") {
    console.log(`\n${event.content}\n`);
  }
  // model 事件是内部推理过程，不在交互界面单独打印
}

function helpText(tools: { name: string; description: string }[]): string {
  const lines = ["可用工具：", ...tools.map((t) => `  · ${t.name} — ${t.description}`)];
  lines.push("", "命令：/help 查看帮助 · /exit 退出");
  return lines.join("\n");
}

/** 底部状态栏展示的模型名：优先取环境变量配置，离线 stub 时显示 stub */
function modelLabel(): string {
  loadEnvFile();
  return process.env.LLM_MODEL ?? process.env.DEEPSEEK_MODEL ?? "stub";
}

async function main(): Promise<void> {
  const agent = new Agent({ onEvent: renderEvent });
  const statusLine = `${modelLabel()} · 就绪 · 待处理`;

  console.log(BANNER);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("> ");

  const handle = async (raw: string): Promise<void> => {
    const prompt = raw.trim();

    if (prompt === "/exit" || prompt === "quit") {
      rl.close();
      return;
    }
    if (prompt === "/help") {
      console.log(helpText(agent.registry.toolDefinitions()));
      console.log("> ");
      return;
    }
    if (!prompt) {
      console.log("> ");
      return;
    }

    try {
      const session = await agent.run(prompt);
      const file = session.dump(".dsh/sessions");
      console.log("本轮完成");
      console.log(statusLine);
      console.log(`> ${file}`);
    } catch (err) {
      console.error(`[运行出错] ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log("> ");
  };

  // 串行排队处理输入行；关闭时等当前这轮跑完再退出，避免管道/EOF 抢先结束
  let chain = Promise.resolve();
  rl.on("line", (raw) => {
    chain = chain.then(() => handle(raw));
  });

  rl.on("close", () => {
    chain.finally(() => {
      console.log("\n再见。");
      process.exit(0);
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
