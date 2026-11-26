/**
 * plugins/registry.ts — 工具注册表
 * 对应 dsh 上游 core 的 tools 包：负责装载插件、按名查找、统一分发执行。
 * 注册表不再认识具体工具，只认 ToolPlugin 接口；新增工具不用改这里。
 */

import type { ToolCall } from "../llm";
import type { ToolPlugin } from "./types";

export class ToolRegistry {
  private readonly plugins = new Map<string, ToolPlugin>();

  /** 注册一个插件，后注册的同名插件会覆盖前者 */
  register(plugin: ToolPlugin): this {
    this.plugins.set(plugin.name, plugin);
    return this;
  }

  /** 批量注册一组插件（preset 整体装载入口） */
  registerAll(plugins: readonly ToolPlugin[]): this {
    plugins.forEach((plugin) => this.register(plugin));
    return this;
  }

  list(): ToolPlugin[] {
    return [...this.plugins.values()];
  }

  /** 转成模型接口需要的工具定义清单 */
  toolDefinitions(): { name: string; description: string; parameters: Record<string, unknown> }[] {
    return this.list().map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }

  /** 按工具名分发执行，统一兜底错误，不让单个插件异常炸掉整个闭环 */
  async dispatch(call: ToolCall): Promise<string> {
    const plugin = this.plugins.get(call.name);
    if (!plugin) {
      return `[error] 未知工具: ${call.name}`;
    }
    try {
      return await plugin.execute(call.args);
    } catch (err) {
      return `[error] 工具 ${call.name} 执行失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
