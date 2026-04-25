// relay/src/relay.ts
import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as tls from "tls";
import * as os from "os";

// ─── Configuration ───────────────────────────────────────────────
const LISTEN_HOST = "0.0.0.0";
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || "8787", 10);
const TARGET_HOST = process.env.TARGET_HOST || "llmhub.cater-wh.workers.dev";
const TARGET_PORT = parseInt(process.env.TARGET_PORT || "443", 10);
const PROXY_HOST = process.env.PROXY_HOST || "127.0.0.1";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "15715", 10);
// ─── Retry config ────────────────────────────────────────────────
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 150;
const RETRYABLE_ERRORS = [
  "Client network socket disconnected before secure TLS connection was established",
  "socket hang up",
  "ECONNRESET",
  "Error",
];

function isRetryable(err: Error): boolean {
  return RETRYABLE_ERRORS.some((msg) => err.message.includes(msg));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Stats ───────────────────────────────────────────────────────
let activeConnections = 0;
let totalRequests = 0;
let totalBytesUp = 0;
let totalBytesDown = 0;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ts(): string {
  return new Date().toLocaleTimeString();
}

// ─── Get LAN IPs ─────────────────────────────────────────────────
function getLanIPs(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const name in interfaces) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

// ─── Build CONNECT tunnel through upstream proxy ──────────────────
function connectThroughProxy(targetHost: string, targetPort: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: PROXY_HOST, port: PROXY_PORT }, () => {
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        `Proxy-Connection: keep-alive\r\n\r\n`
      );

      let buf = Buffer.alloc(0);

      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);

        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd === -1) return; // 头还没收完，继续等

        // ① 先停掉监听器和超时
        socket.removeListener("data", onData);
        socket.removeListener("error", reject);
        socket.setTimeout(0);

        // ② 关键：暂停 socket，让 TLS 有机会接管，避免数据丢失
        socket.pause();

        const statusLine = buf.slice(0, buf.indexOf("\r\n")).toString();

        // ③ 把 CONNECT 响应头之后多读的字节塞回去
        const remainder = buf.slice(headerEnd + 4);
        if (remainder.length > 0) {
          socket.unshift(remainder);
        }

        if (/^HTTP\/1\.[01] 200/.test(statusLine)) {
          resolve(socket);
        } else {
          socket.destroy();
          reject(new Error(`Proxy CONNECT failed: ${statusLine}`));
        }
      };

      socket.on("data", onData);
    });

    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new Error("Proxy connection timed out"));
    });
    socket.once("error", reject);
  });
}

// ─── HTTP Relay Server ───────────────────────────────────────────
const server = http.createServer((req, res) => {
  const clientAddr = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
  const reqPath = req.url ?? "/";

  activeConnections++;
  totalRequests++;

  const done = () => { activeConnections = Math.max(0, activeConnections - 1); };
  res.once("finish", done);
  res.once("close", done);

  console.log(`[${ts()}] [>] ${req.method} ${reqPath}  (from ${clientAddr})`);

  // ── 收集 body，重试时可以复用 ──────────────────────────────────
  const bodyChunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => {
    totalBytesUp += chunk.length;
    bodyChunks.push(chunk);
  });

  req.on("end", () => {
    const body = Buffer.concat(bodyChunks);
    attemptRequest(req, res, reqPath, body, 0);
  });
});

function attemptRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqPath: string,
  body: Buffer,
  attempt: number
): void {
  connectThroughProxy(TARGET_HOST, TARGET_PORT)
    .then((rawSocket) => {
      const tlsSocket = tls.connect({
        socket: rawSocket,
        servername: TARGET_HOST,
        rejectUnauthorized: true,
      });

      let tlsErrored = false;

      tlsSocket.once("error", (err) => {
        tlsErrored = true;
        if (attempt < MAX_RETRIES && isRetryable(err)) {
          console.warn(
            `[${ts()}] [~] TLS error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS}ms... — ${err.message}`
          );
          delay(RETRY_DELAY_MS).then(() =>
            attemptRequest(req, res, reqPath, body, attempt + 1)
          );
        } else {
          console.error(`[${ts()}] [!] TLS error (给up): ${err.message}`);
          if (!res.headersSent) { res.writeHead(502); res.end(err.message); }
        }
      });

      const headers: http.OutgoingHttpHeaders = { ...req.headers };
      headers["host"] = TARGET_HOST;
      headers["content-length"] = body.length;
      delete headers["proxy-connection"];
      delete headers["proxy-authorization"];
      delete headers["transfer-encoding"];

      const proxyReq = https.request(
        {
          createConnection: () => tlsSocket,
          hostname: TARGET_HOST,
          port: TARGET_PORT,
          path: reqPath,
          method: req.method,
          headers,
        },
        (proxyRes) => {
          if (attempt > 0) {
            console.log(`[${ts()}] [✓] Retry succeeded on attempt ${attempt + 1}`);
          }
          console.log(`[${ts()}] [<] ${req.method} ${reqPath} → ${proxyRes.statusCode}`);

          proxyRes.on("data", (chunk: Buffer) => { totalBytesDown += chunk.length; });

          const resHeaders = { ...proxyRes.headers };
          for (const h of ["transfer-encoding", "connection", "keep-alive", "upgrade"]) {
            delete resHeaders[h];
          }

          res.writeHead(proxyRes.statusCode!, resHeaders);
          proxyRes.pipe(res, { end: true });
        }
      );

      proxyReq.once("error", (err) => {
        if (tlsErrored) return; // TLS 层已经在处理，不重复触发
        if (attempt < MAX_RETRIES && isRetryable(err)) {
          console.warn(
            `[${ts()}] [~] Request error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS}ms... — ${err.message}`
          );
          delay(RETRY_DELAY_MS).then(() =>
            attemptRequest(req, res, reqPath, body, attempt + 1)
          );
        } else {
          console.error(`[${ts()}] [!] Request error (给up): ${err.message}`);
          if (!res.headersSent) { res.writeHead(502); res.end(err.message); }
        }
      });

      // 直接写入已缓冲的 body，不再 pipe req
      if (body.length > 0) proxyReq.write(body);
      proxyReq.end();
    })
    .catch((err) => {
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        console.warn(
          `[${ts()}] [~] Tunnel error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying... — ${err.message}`
        );
        delay(RETRY_DELAY_MS).then(() =>
          attemptRequest(req, res, reqPath, body, attempt + 1)
        );
      } else {
        console.error(`[${ts()}] [!] Proxy tunnel error (给up): ${err.message}`);
        if (!res.headersSent) { res.writeHead(502); res.end(err.message); }
      }
    });
}

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nError: Port ${LISTEN_PORT} is already in use.\n`);
  } else if (err.code === "EACCES") {
    console.error(`\nError: Permission denied for port ${LISTEN_PORT}.\n`);
  } else {
    console.error(`\nServer error: ${err.message}\n`);
  }
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  const lanIPs = getLanIPs();
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   HTTP → HTTPS Relay Started                ║
╠══════════════════════════════════════════════════════════════╣
║  Listen:  ${LISTEN_HOST}:${LISTEN_PORT}                                    ║
║  Target:  https://${TARGET_HOST}:${TARGET_PORT}             ║
║  UpProxy: ${PROXY_HOST}:${PROXY_PORT}                               ║
╠══════════════════════════════════════════════════════════════╣
║  LAN devices can point API base URL to:                     ║`);
  for (const ip of lanIPs) {
    const addr = `http://${ip}:${LISTEN_PORT}`;
    console.log(`║    ${addr.padEnd(54)}║`);
  }
  console.log(`╠══════════════════════════════════════════════════════════════╣
║  Press Ctrl+C to stop                                       ║
╚══════════════════════════════════════════════════════════════╝
`);
});

// ─── Graceful Shutdown ───────────────────────────────────────────
function shutdown() {
  console.log(`\n[${ts()}] Shutting down...`);
  console.log(
    `[${ts()}] Stats: ${totalRequests} requests, ` +
    `↑ ${formatBytes(totalBytesUp)}, ↓ ${formatBytes(totalBytesDown)}`
  );
  server.close(() => { console.log(`[${ts()}] Server closed.`); process.exit(0); });
  setTimeout(() => process.exit(0), 3_000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);