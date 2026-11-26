/**
 * plugins/preset.ts — 内置 preset 插件清单
 * “preset”的作用：把一组默认工具打包成一份清单，Agent 启动时整体装载。
 * 以后新增工具插件，只要写好插件文件、加进这个数组即可，
 * 注册表、循环、TUI 都不用改。
 */

import { bashPlugin } from "./bash";
import { webSearchPlugin } from "./web-search";
import { webFetchPlugin } from "./web-fetch";
import type { ToolPlugin } from "./types";
import { ToolRegistry } from "./registry";

export const builtinPreset: ToolPlugin[] = [bashPlugin, webSearchPlugin, webFetchPlugin];

/** 用内置 preset 建一个装好全部默认工具的注册表 */
export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry().registerAll(builtinPreset);
}
