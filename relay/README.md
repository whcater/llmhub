# HTTP → HTTPS Relay

一个轻量级 Node.js 中继服务，将本地 HTTP 请求通过上游 HTTP 代理转发到远端 HTTPS API，适用于局域网设备共享代理访问 LLM API 的场景。

## 工作原理

```
客户端 (HTTP)
    │  POST http://127.0.0.1:8787/v1/chat/completions
    ▼
relay:8787  ── TCP ──▶  upstream-proxy:15715
                            │  CONNECT target-host:443 HTTP/1.1
                            ▼
                        CONNECT 隧道建立 → TLS 握手
                            │  HTTPS POST /v1/chat/completions
                            ▼
                        llmhub.cater-wh.workers.dev:443
```

客户端只需发普通 HTTP 请求，relay 会自动完成：
1. 通过上游代理建立 `CONNECT` 隧道
2. 在隧道上完成 TLS 握手
3. 将请求转换为 HTTPS 转发到目标服务器
4. 将响应透传回客户端

## 环境要求

- Node.js >= 18
- npm

## 安装

```bash
git clone <repo-url>
cd relay
npm install
```

## 启动

```bash
# 使用默认配置启动
npm start

# 自定义参数启动
LISTEN_PORT=8787 PROXY_HOST=127.0.0.1 PROXY_PORT=15715 npm start
```

启动后终端会显示当前局域网可用地址：

```
╔══════════════════════════════════════════════════════════════╗
║                   HTTP → HTTPS Relay Started                ║
╠══════════════════════════════════════════════════════════════╣
║  Listen:  0.0.0.0:8787                                      ║
║  Target:  https://llmhub.cater-wh.workers.dev:443           ║
║  UpProxy: 127.0.0.1:15715                                   ║
╠══════════════════════════════════════════════════════════════╣
║  LAN devices can point API base URL to:                     ║
║    http://192.168.1.100:8787                                ║
╚══════════════════════════════════════════════════════════════╝
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LISTEN_PORT` | `8787` | relay 监听端口 |
| `TARGET_HOST` | `llmhub.cater-wh.workers.dev` | 目标 HTTPS 主机名 |
| `TARGET_PORT` | `443` | 目标端口 |
| `PROXY_HOST` | `127.0.0.1` | 上游 HTTP 代理地址 |
| `PROXY_PORT` | `15715` | 上游 HTTP 代理端口 |

## 客户端配置示例

将 API base URL 指向 relay 地址即可，无需任何其他改动：

```bash
# 本机使用
OPENAI_BASE_URL=http://127.0.0.1:8787

# 局域网其他设备使用（替换为 relay 机器的局域网 IP）
OPENAI_BASE_URL=http://192.168.1.100:8787
```

兼容所有使用 OpenAI 格式的客户端，例如 Open WebUI、ChatBox、Cursor 等。

## 停止服务

按 `Ctrl+C`，relay 会优雅关闭并打印统计信息：

```
[18:00:00] Shutting down...
[18:00:00] Stats: 42 requests, ↑ 128.3 KB, ↓ 2.1 MB
[18:00:00] Server closed.
```

## 常见问题

**Q: 第一次请求偶尔报 TLS 错误？**

确保使用了修复后的 `connectThroughProxy`，关键点是移除 `data` 监听器后立即调用 `socket.pause()`，并用 `socket.unshift()` 将多读的字节塞回，防止 TLS 握手前数据丢失。

**Q: 局域网其他设备无法访问？**

检查运行 relay 的机器防火墙是否放行了对应端口（默认 8787）。

**Q: 代理需要认证怎么办？**

在 `connectThroughProxy` 的请求头里加上：

```typescript
`Proxy-Authorization: Basic ${Buffer.from("user:pass").toString("base64")}\r\n`
```