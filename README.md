# dsh-agent-lab — 实验四：websearch 工具 + preset 插件管理 + TUI

课程实验四：在实验三最小 core 的基础上，实现一个联网搜索 Agent。
用户在命令行（TUI）里提问，Agent 自动调用 `web-search` 搜索网页、`web-fetch` 读取页面，最后给出答复。

## 一、对照作业要求

| 作业要求 | 本项目实现 |
|---|---|
| 构建 websearch tool（可用 DeepSeek API，或免费 DuckDuckGo / Tavily 等第三方搜索） | `src/plugins/web-search.ts`，免费后端为 Bing 中文搜索页，无需搜索 API 密钥；另附 `web-fetch` 抓取页面正文 |
| 理解 dsh 源码中 preset 插件管理原理，落实到自己项目 | `src/plugins/preset.ts` + `registry.ts`：插件按接口自包含编写，preset 清单整体装载，注册表统一查名分发 |
| 构建 TUI，成功实现一个启动 websearch 工具的回复 | `src/tui.ts` 命令行交互界面；`src/demo.ts` 非交互演示入口 |

## 二、目录结构

```
dsh-agent-lab/
├── src/
│   ├── llm.ts              # 模型接缝：Llm 接口 + DeepSeekLlm + 离线 StubLlm
│   ├── session.ts          # 会话消息记录，支持落盘 JSON
│   ├── agent-loop.ts       # 调度闭环：推理 → 工具调用 → 回填 → 收敛
│   ├── agents.ts           # Agent 装配层
│   ├── tui.ts              # 命令行交互入口（交付的 TUI）
│   ├── demo.ts             # 非交互演示入口，冒烟测试 / 留档截图用
│   ├── error-test.ts       # 定向测试
│   ├── index.ts            # 统一导出
│   └── plugins/
│       ├── types.ts        # ToolPlugin 插件接口定义
│       ├── registry.ts     # 注册表：装载、查名、分发执行
│       ├── preset.ts       # 内置 preset：默认工具清单 + 注册表工厂
│       ├── bash.ts         # execute_bash 插件
│       ├── web-search.ts    # web-search 插件（Bing 搜索解析）
│       └── web-fetch.ts     # web-fetch 插件（页面正文抓取）
├── logs/                   # 每次会话落盘的 JSON
├── package.json
└── tsconfig.json
```

## 三、运行方法

### 1. 安装依赖

```bash
npm install
```

### 2. 跑定向测试

```bash
npm test
```

### 3. 启动 TUI（交互界面）

```bash
npm start
```

启动后输入问题回车；`/help` 查看帮助，`/exit` 退出。

### 4. 非交互演示（自动跑一条问题，适合截图留档）

```bash
npm run demo "你的问题"
```

### 5. 接入真实模型（可选）

默认不设密钥时走离线 Stub 模型，也能跑通闭环。接入 DeepSeek 后由真实模型自己决定何时搜索：

```bash
export DEEPSEEK_API_KEY="sk-xxxxxxxx"
export DEEPSEEK_MODEL="deepseek-chat"   # 可选，默认 deepseek-chat
# export DEEPSEEK_BASE_URL="https://api.deepseek.com"  # 可选，一般不用改
npm start
```

密钥只通过环境变量注入，**不写进代码、不提交 GitHub**。

## 四、preset 插件管理原理

### 4.1 插件接口（`types.ts`）

每个工具都是一个自包含对象：

```ts
interface ToolPlugin {
  name: string;                              // 工具名，模型按名调用
  description: string;                       // 给模型看的说明
  parameters: ToolParameters;                 // 参数 JSON Schema
  execute(args): Promise<string>;            // 真正执行并返回字符串结果
}
```

### 4.2 注册表（`registry.ts`）

- `register(plugin)`：把插件装进 Map，按名索引；
- `toolDefinitions()`：把所有插件转成模型接口要的工具定义清单；
- `dispatch(call)`：按名查到插件执行，统一兜底异常。

注册表不认识任何具体工具，只认 `ToolPlugin` 接口。

### 4.3 预设清单（`preset.ts`）

内置 preset 就是一组默认插件的打包清单：

```ts
export const builtinPreset: ToolPlugin[] = [bashPlugin, webSearchPlugin, webFetchPlugin];
```

`createDefaultRegistry()` 一次性把整组插件注册好。**以后新增工具的流程**：写一个新插件文件 → 加进 `builtinPreset` 数组，注册表、循环、TUI 都不用动。

### 4.4 与上游 dsh core 的对应关系

| 上游 core 概念 | 本项目对应实现 |
|---|---|
| tools 包（工具注册表与执行流水线） | `plugins/registry.ts` |
| tool-executor-native（原生工具执行插件） | `plugins/*.ts` 各插件的 `execute` |
| agent-loop（默认驱动器） | `agent-loop.ts` |
| session（会话事件日志） | `session.ts` |
| 模型接缝（llm seam） | `llm.ts` |

## 五、闭环流程

```
用户提问
  → system + user 入 Session
  → 模型推理（决定是否调用工具）
  → 注册表分发到对应插件执行（web-search / web-fetch / execute_bash）
  → 工具结果回填为 tool 消息
  → 再推理，直到模型不再调用工具
  → 输出最终答复，会话落盘 logs/
```

## 六、测试覆盖

- Session 消息计数与只读历史；
- 默认注册表装载 3 个工具；
- Stub 模型两轮后收敛，最后一轮不带工具调用；
- 一直请求工具时超过 `maxSteps` 强制中止；
- 未知工具返回错误串而不崩溃。

## 七、已知限制

- 搜索后端为 Bing 中文页解析，结果质量受搜索引擎影响；未接付费搜索 API。
- 离线 Stub 模型只按脚本调用一次搜索，不会真正阅读结果；真实总结需接入 DeepSeek 模型。
- web-fetch 只返回纯文本正文，不解析图片、表格等结构化内容。
