/**
 * plugins/bash.ts — execute_bash 插件
 * 在本地 shell 执行一条命令，把标准输出 / 错误作为结果返回。
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolPlugin } from "./types";

const execAsync = promisify(exec);

/** 剥掉终端颜色转义码，保证落盘日志是纯文本 */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

export const bashPlugin: ToolPlugin = {
  name: "execute_bash",
  description: "在当前机器上执行一条 shell 命令，返回标准输出和标准错误。",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "要执行的 shell 命令" },
    },
    required: ["command"],
  },
  async execute(args) {
    const command = String(args.command ?? "").trim();
    if (!command) return "[error] 缺少 command 参数";
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 15_000 });
      return stripAnsi([stdout, stderr].filter(Boolean).join("\n")).trim() || "(命令无输出)";
    } catch (err) {
      return `[error] ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
