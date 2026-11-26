/**
 * plugins/types.ts — 插件（工具）统一接口
 * 一个插件 = 名称 + 描述 + 参数 schema + 执行函数，自包含、可独立注册。
 * 这对应 dsh 上游 core 里“工具注册表 + 原生工具执行插件”那套结构。
 */

export interface ToolParameters extends Record<string, unknown> {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolPlugin {
  /** 工具名，模型通过这个名字调用，必须全局唯一 */
  name: string;
  /** 给模型看的一句话说明，决定模型什么时候想到用它 */
  description: string;
  /** 参数 JSON Schema，告诉模型每个参数的类型和含义 */
  parameters: ToolParameters;
  /** 真正执行工具，返回字符串结果回填给模型 */
  execute(args: Record<string, unknown>): Promise<string>;
}
