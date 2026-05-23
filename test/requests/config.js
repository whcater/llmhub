// config.js - llmhub 测试共享配置
// llmhub 路由格式: /{provider}/{subpath}
// 例如 /openai/v1/chat/completions 透传到 openai endpoint
//      /anthropic/v1/messages       透传到 anthropic endpoint
//
// 环境变量:
//   LLMHUB_URL   llmhub 部署地址 (默认 http://localhost:8787)
//   LLMHUB_TOKEN llmhub 自身 auth_token (KV 里 auth_token 字段)
//   PROVIDER     测试的目标 provider (默认 openai)
//   MODEL        请求里带的 model 字段 (默认 gpt-4o-mini)

const LLMHUB_URL   = process.env.LLMHUB_URL   || "http://localhost:8788";
const LLMHUB_TOKEN = process.env.OPENAI_API_KEY || "default-key";
export const PROVIDER = process.env.PROVIDER  || "openai";
export const MODEL    = process.env.MODEL     || "gpt-4o-mini";

export const BASE_URL = `${LLMHUB_URL}/${PROVIDER}`;
export const API_KEY  = LLMHUB_TOKEN;

/**
 * 发送 OpenAI 兼容 chat completions 请求,自动处理流式 / 非流式。
 * 默认 path: /v1/chat/completions
 * @param {object} payload 请求体
 * @param {object} [opts]  额外选项 { path }
 * @returns {Promise<object>} 解析过的响应:
 *   - 非流式: { text, toolCalls, raw }
 *   - 流式:   { text, toolCalls, events, raw: null }
 */
export async function chat(payload, opts = {}) {
  const path = opts.path || "/v1/chat/completions";
  const url = `${BASE_URL}${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, ...payload }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  if (payload.stream) {
    let text = "";
    const toolCallsAcc = []; // index → { id, name, arguments }
    let events = 0;
    const decoder = new TextDecoder();
    let buf = "";

    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            events++;
            const choice = json.choices?.[0];
            const delta = choice?.delta;
            if (delta?.content) {
              process.stdout.write(delta.content);
              text += delta.content;
            }
            if (Array.isArray(delta?.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const i = tc.index ?? 0;
                toolCallsAcc[i] = toolCallsAcc[i] || { id: "", name: "", arguments: "" };
                if (tc.id) toolCallsAcc[i].id = tc.id;
                if (tc.function?.name) toolCallsAcc[i].name += tc.function.name;
                if (tc.function?.arguments) toolCallsAcc[i].arguments += tc.function.arguments;
              }
            }
          } catch { /* 非 JSON,跳过 */ }
        }
      }
    }
    console.log();
    return { text, toolCalls: toolCallsAcc.filter(Boolean), events, raw: null };
  }

  // 非流式
  const json = await res.json();
  const message = json.choices?.[0]?.message;
  const text = message?.content ?? "";
  const toolCalls = (message?.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: tc.function?.arguments,
  }));
  if (text) console.log(text);
  if (toolCalls.length) {
    console.log("tool_calls:");
    for (const tc of toolCalls) console.log(`  ${tc.name}(${tc.arguments})`);
  }
  return { text, toolCalls, raw: json };
}

/** 简单计时包装 */
export async function timed(label, fn) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`▶  ${label}`);
  console.log(`   ${PROVIDER} / ${MODEL}  →  ${BASE_URL}`);
  console.log(`${"─".repeat(60)}`);
  const t0 = Date.now();
  const result = await fn();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${"─".repeat(60)}`);
  console.log(`✓  完成  耗时 ${elapsed}s`);
  return result;
}
