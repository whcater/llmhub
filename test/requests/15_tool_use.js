/**
 * 15_tool_use.js - 原生 tool_use 测试 (OpenAI 兼容路由)
 *
 * 与参考实现 (llm-web-proxy/tests/requests/15_tool_use.js) 的差异:
 *   参考端用 prompt 引导让模型吐 tool_calls JSON,因为它的后端是纯文本 web chat;
 *   llmhub 是透传代理,可以直接走上游 provider 的**原生 tools 协议**,
 *   所以这里把 tools 字段塞进请求体,断言响应里的 message.tool_calls。
 *
 * 验证:
 *   1. 上游返回 finish_reason = tool_calls (或包含 tool_calls 字段)
 *   2. 模型挑对了工具名 (get_weather)
 *   3. arguments 里 location 包含 tokyo / 东京
 *   4. 流式 / 非流式两种模式都通
 *
 * 运行:
 *   node test/requests/15_tool_use.js
 *   PROVIDER=openai MODEL=gpt-4o-mini node test/requests/15_tool_use.js
 *   PROVIDER=grok   MODEL=grok-2     node test/requests/15_tool_use.js
 */
import { chat, timed, PROVIDER, MODEL } from "./config.js";

const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "获取指定城市的当前天气",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "城市名称,如 Tokyo" },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "温度单位",
          },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "获取指定时区的当前时间",
      parameters: {
        type: "object",
        properties: {
          timezone: { type: "string", description: "IANA 时区,如 Asia/Tokyo" },
        },
        required: ["timezone"],
      },
    },
  },
];

const messages = [
  { role: "user", content: "帮我查一下东京现在的天气,用摄氏度。" },
];

// ── 校验函数 ────────────────────────────────────────────────
function assertWeatherCall(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    throw new Error("响应里没有 tool_calls");
  }
  const tc = toolCalls[0];
  if (tc.name !== "get_weather") {
    throw new Error(`工具名错误,期望 get_weather,实际 ${tc.name}`);
  }
  const args =
    typeof tc.arguments === "string" ? JSON.parse(tc.arguments) : tc.arguments;
  const loc = String(args.location || "").toLowerCase();
  if (!loc.includes("tokyo") && !String(args.location || "").includes("东京")) {
    throw new Error(`参数 location 不正确: ${JSON.stringify(args)}`);
  }
  console.log(`\n✅ tool_calls 解析成功`);
  console.log(`   工具: ${tc.name}`);
  console.log(`   参数: ${JSON.stringify(args)}`);
}

// ── 用例 1: 非流式 ──────────────────────────────────────────
try {
  const r = await timed(
    "Tool use - 非流式 (原生 tools 协议)",
    () => chat({ stream: false, tools, tool_choice: "auto", messages })
  );
  assertWeatherCall(r.toolCalls);
} catch (e) {
  console.log(`\n❌ 非流式失败: ${e.message}`);
}

// ── 用例 2: 流式 ───────────────────────────────────────────
try {
  const r = await timed(
    "Tool use - 流式 (delta.tool_calls 增量拼接)",
    () => chat({ stream: true, tools, tool_choice: "auto", messages })
  );
  console.log(`   收到 ${r.events} 个 SSE 事件`);
  assertWeatherCall(r.toolCalls);
} catch (e) {
  console.log(`\n❌ 流式失败: ${e.message}`);
}
