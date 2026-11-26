import assert from "node:assert";
import { Agent } from "./agents";
import { Session } from "./session";
import { StubLlm, type Llm, type LlmReply } from "./llm";
import { createDefaultRegistry } from "./plugins/preset";

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// 一直请求工具的 stub，用于验证 maxSteps 保护
class InfiniteToolLlm implements Llm {
  async chat(): Promise<LlmReply> {
    return {
      content: "继续调用工具",
      tool_calls: [{ id: "call-x", name: "nonexistent_tool", args: {} }],
    };
  }
}

async function main(): Promise<void> {
  console.log("定向测试开始：");

  await check("Session 追加消息后计数正确、history 只读返回", () => {
    const s = new Session("test-sess");
    s.push({ role: "user", content: "你好" });
    s.push({ role: "assistant", content: "在的" });
    assert.equal(s.length(), 2);
    assert.equal(s.history().length, 2);
  });

  await check("默认注册表已装载 web-search / web-fetch / execute_bash", () => {
    const registry = createDefaultRegistry();
    const names = registry.toolDefinitions().map((t) => t.name);
    assert.deepEqual(names.sort(), ["execute_bash", "web-fetch", "web-search"]);
  });

  await check("StubLlm 两轮后收敛：最后一轮不带 tool_calls", async () => {
    const agent = new Agent({ llm: new StubLlm() });
    const session = await agent.run("测试闭环");
    const last = session.history()[session.length() - 1];
    assert.equal(last.role, "assistant");
    assert.ok(!last.tool_calls || last.tool_calls.length === 0);
  });

  await check("超过 maxSteps 应强制中止并抛错", async () => {
    const agent = new Agent({ llm: new InfiniteToolLlm(), maxSteps: 2 });
    await assert.rejects(() => agent.run("跑不完的任务"), /超过最大循环步数/);
  });

  await check("未知工具返回错误串而不是崩溃", async () => {
    const registry = createDefaultRegistry();
    const result = await registry.dispatch({ id: "c1", name: "no_such_tool", args: {} });
    assert.match(result, /未知工具/);
  });

  console.log(`\n全部通过：${passed} 项定向测试。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
