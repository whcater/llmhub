/**
 * 00_health_check.js - 健康检查测试
 *
 * 验证 llmhub 实例本身是否存活且基本路由可达。
 *
 * 运行:
 *   node test/requests/00_health_check.js
 *   LLMHUB_URL=http://your-host:8788 node test/requests/00_health_check.js
 */
import { LLMHUB_URL } from "./config.js";

// ── 用例 1: GET / 返回 200 ──────────────────────────────────
try {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`▶  健康检查 - 根路径`);
  console.log(`   ${LLMHUB_URL}`);
  console.log(`${"─".repeat(60)}`);

  const t0 = Date.now();
  const res = await fetch(LLMHUB_URL);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  console.log(`✓  GET / → ${res.status}  耗时 ${elapsed}s`);
  console.log(`✓  服务正常`);
} catch (e) {
  console.log(`\n❌ 健康检查失败: ${e.message}`);
  process.exit(1);
}
