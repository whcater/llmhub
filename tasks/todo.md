# ASR 模块接入 — Todo

完整方案见 `~/.claude/plans/recursive-mixing-porcupine.md`。

---

## Sprint 1 — 后端 REST: `/asr/transcribe`

### 类型 & 路由

- [x] `src/types.ts`:`ProviderName` 加 `"alinls"`;`Endpoint` 加可选字段 `aliAccessKeyId?` / `nlsAppKey?` / `lyBlueBearerToken?` / `lyBlueOaid?`
- [x] `src/index.ts`:在 router 块加 `/asr/transcribe` 分支,转入 `handleAsrTranscribe`(不走 `/{provider}/*` 通用代理);`buildUpstreamRequest` switch 加 default 防护,export `verifyToken/selectEndpoint/isLogsEnabled`
- [x] `src/admin.ts:5`:`SUPPORTED_PROVIDERS` 加 `"alinls"`;`sanitizeEndpoint` 透传 4 个新字段

### 业务逻辑

- [x] 新建 `src/asr.ts`,实现:
  - [x] `aliyunUrlEncode` (RFC3986 + `~`)
  - [x] `nlsCreateToken(ak, sk)` — HMAC-SHA1 via SubtleCrypto
  - [x] `lyBlueGetAliConfig(bearer, oaid)` — 调 ly-blue 拿 AK/SK + AppKey
  - [x] `lyBlueTemporaryLogin(oaid)` — 匿名 bearer fallback
  - [x] `NlsTokenManager`:KV `asr:nls_token` 缓存 23h,过期重签
  - [x] `handleAsrTranscribe(req, env, ctx)`:鉴权 → 选 endpoint → 取 NLS token → 转发音频到 FlashRecognizer → 标准化 sentences[]
  - [x] 复用 `writeRequestLog/writeResponseLog`(logger.ts)

### Admin UI + 测试

- [~] **延后到 S2**:alinls 单独的 admin UI tab + `testEndpoint` case。原因:alinls 字段集(lyBlueOaid 等)和现有 `testEndpoint` 入参 schema 不兼容,做成 generic UI 复杂度高。S1 改为 KV CLI 配置;`admin.ts:5 SUPPORTED_PROVIDERS` 已加 alinls,所以 `/admin/api/providers/alinls` 的 CRUD JSON 已经可用,只是没图形界面。
- [x] `test/requests/asr.http`:curl 示例 + KV 配置命令

### 验收

- [x] `npx tsc --noEmit` 通过(零类型错)
- [x] `wrangler dev` 启动成功;**negative path 全通**:
  - `GET /asr/transcribe` → `405 {"error":"Method not allowed"}`
  - `POST /asr/transcribe` (无 auth) → `401 Missing or invalid Authorization header`
  - `POST /asr/transcribe` (错 auth) → `403 Invalid token`
- [ ] **positive path 需要 ly-blue 凭证**:依赖 `C:\dev\lab\reverse\recordIdentify\config.json` 中的 `bearer_token` + `device_oaid`。验证步骤见下方"用户验证 SOP"
- [ ] `npm run deploy` 部署 + 远端 curl

---

## 用户验证 SOP (S1 positive path)

```bash
# 1. 启动 dev server (如果还没跑)
cd C:/dev/lab/llmhub
npm run dev    # 在 127.0.0.1:8787
                # 当前后台已有一个跑在 8787 (PID 不确定; 不需要就 Ctrl+C)

# 2. 写入 LLMHub auth_token (用任意 32 字节 hex 字符串)
TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "Auth token: $TOKEN"
# 用 wrangler 写入 local KV (dev server 内部用的是 miniflare KV)
# ⚠ 注意: --local 与 wrangler dev 默认的 KV 是同一个吗?
#   - wrangler dev 默认是 local mode (miniflare)
#   - 都写在 .wrangler/state/v3/kv/ 下的 sqlite
#   - 二者应该一致, 否则就用 admin UI: 打开 http://localhost:8787/admin → 生成 token
npx wrangler kv key put auth_token "$TOKEN" --binding LLMHUB_KV --local

# 3. 从 recordIdentify 拿 ly-blue 凭证, 配置 alinls endpoint
BEARER=$(node -e "console.log(JSON.parse(require('fs').readFileSync('C:/dev/lab/reverse/recordIdentify/config.json')).bearer_token)")
OAID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('C:/dev/lab/reverse/recordIdentify/config.json')).device_oaid)")

CONFIG=$(cat <<EOF
{
  "endpoints": [{
    "baseUrl": "https://nls-gateway.cn-shanghai.aliyuncs.com",
    "apiKey": "",
    "enabled": true,
    "lyBlueBearerToken": "$BEARER",
    "lyBlueOaid": "$OAID"
  }],
  "strategy": "failover-on-error"
}
EOF
)
npx wrangler kv key put provider:alinls "$CONFIG" --binding LLMHUB_KV --local


# 4. 跑短音频转写
curl -X POST "http://127.0.0.1:8787/asr/transcribe?format=MP3&sample_rate=16000" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @C:/dev/lab/reverse/recordIdentify/sample.mp3

# 预期: {"sentences":[...], "full":"...", "taskId":"...", "upstreamStatus":20000000}
```

``` powershell

$config = Get-Content "C:\dev\lab\reverse\recordIdentify\config.json" | ConvertFrom-Json

$BEARER = $config.bearer_token
$OAID = $config.device_oaid

$kvConfig = @{
    endpoints = @(
        @{
            baseUrl = "https://nls-gateway.cn-shanghai.aliyuncs.com"
            apiKey = ""
            enabled = $true
            lyBlueBearerToken = $BEARER
            lyBlueOaid = $OAID
        }
    )
    strategy = "failover-on-error"
} | ConvertTo-Json -Depth 10

Set-Content -Path ".tmp-kv.json" -Value $kvConfig

npx wrangler kv key put provider:alinls --path .tmp-kv.json --binding LLMHUB_KV --local
```

curl -X POST http://localhost:8787/asr/transcribe?lang=0 -H "Authorization: Bearer %OPENAI_API_KEY%" -H "X-Audio-Format: MP3" --data-binary @C:/dev/lab/reverse/recordIdentify/sample.mp3

如果 4 步报错,常见原因:
- ly-blue bearer 过期 (49d) → 跑 `python C:/dev/lab/reverse/recordIdentify/login.py` 刷新 config.json 后重做 step 3
- KV 配置未生效 → `npx wrangler kv key get provider:alinls --binding LLMHUB_KV --local` 看回写
- `Failed to acquire NLS token` → ly-blue 接口不通,或者 AK/SK 失效

---

## Sprint 2 — 后端 WSS: `/asr/stream` + Admin UI 补全

- [x] `handleAsrStream` (asr.ts) — `WebSocketPair` 接客户端 + `fetch{Upgrade:websocket}` 拨上游 + 双向桥接
- [x] StartTranscription 注入 appKey,客户端只发音频和 stop 控制帧
- [x] WS 鉴权 `verifyWsToken`:接受 `Authorization: Bearer` 或 `?token=`(WS 升级带不了自定义 header),常量时间比较
- [x] 桥接计数 + close 日志:bytesIn/bytesOut/sentenceCount,双向 close/error 互相传播
- [x] Admin UI alinls tab(独立 `buildAlinlsCard` 函数)
- [x] `testEndpoint` 加 alinls case
- [x] `src/index.ts` router 加 `/asr/stream` 分支

### 验收 (S2)

- [x] `npx tsc --noEmit` 零错
- [x] `wrangler dev` 启动 OK;**negative path 全通**:
  - `GET /asr/stream` (无 upgrade) → `426`
  - `POST /asr/stream` (无 upgrade) → `426`
  - WS 无 token → `401`
  - WS 错 token → `403`
- [ ] **positive path 需 ly-blue 真凭证 + wscat**:用户跑(SOP 同 S1,WS 用 `wscat -c "ws://localhost:8787/asr/stream?token=$TOKEN"`,发 StartTranscription 帧 + 音频二进制帧)

### Review (S2)

**完成**:`/asr/stream` WSS 双向隧道全链路。客户端 WS 接入 → 鉴权 → 选 alinls endpoint → 取 NLS token → `fetch{Upgrade:websocket}` 拨 nls-gateway → 桥接。appKey 由网关在 StartTranscription 控制帧注入,客户端无需持有 AppKey。Admin UI 补了独立 `buildAlinlsCard` + `testEndpoint` 的 alinls case。tsc 零错,4 个 negative path 全通。

**未做(按 brief)**:positive path 需真实 ly-blue 凭证 + wscat,留给用户跑。

**踩坑**:WS 升级请求无法带自定义 header,所以 `verifyWsToken` 额外接受 `?token=` 查询参数;上游拨号失败时仍返回 101 + 已 close 的 client socket(而非 5xx),因为此时 HTTP 响应头已无法再改。

## Sprint 3 — Tauri 客户端 (Windows 实时字幕 MVP)

仓库:根目录 `murmur/`(Tauri 2 + Rust + 原生 TS,与 llmhub 解耦)。

### 后端 (src-tauri/src)

- [x] `audio.rs` — cpal:枚举 output(loopback)+input(mic) 设备;独立线程跑采集;f32/i16/u16 → mono → 线性重采样到 16k → 200ms 帧 → channel。loopback 走 output 设备 `default_output_config` + `build_input_stream`
- [x] `asr.rs` — tokio-tungstenite 连 `ws(s)://<llmhub>/asr/stream?token=`;发 StartTranscription(appkey 留空,worker 注入);转发 PCM binary;解析 TranscriptionResultChanged/SentenceEnd/TaskFailed → emit 事件;指数退避重连(2^n,封顶 15s,6 次)
- [x] `config.rs` — config.json 持久化到 app config 目录(serverUrl/authToken/deviceId/captionLines)
- [x] `lib.rs` — 命令 list_devices/get_config/save_config/start_session/stop_session;编排采集线程 + WS 任务;Session 句柄(audio_stop / ws_stop watch / join)
- [x] `tauri.conf.json` — main 窗口 + caption 窗口(transparent + alwaysOnTop + decorations:false + visible:false);capabilities 授 window show/hide/set-focus

### 前端 (原生 TS + Vite 多页)

- [x] `index.html` + `main.ts` — 全文模式:设备选择/开始停止/字幕模式/复制/清空/设置(serverUrl+token);句子+partial 渲染;listen 三事件
- [x] `caption.html` + `caption.ts` — 透明字幕条:末 N 句 + partial,点击/Esc 返回全文
- [x] `ipc.ts` — invoke 封装 + 事件监听

### 验收 (S3)

- [x] `npm run build`(tsc + vite)零错
- [x] `cargo check` 零错零警告(首次编译 ~9min:tauri/wry/windows crate)
- [ ] **positive path(用户跑)**:`cargo tauri dev` → 设置填 ws 地址 + token → 选默认输出(loopback)→ 播视频 → 3 秒内出字幕;断网 5s 自动重连

### 待办 / 后续 Sprint
- S4:短音频 REST(拖 mp3)+ 长音频客户端切片
- S5/S6:Mac(SCK)/ Linux(Pulse monitor)音频源
- auth token 存 OS keychain(当前存 config.json,明文)

### S3 增补(体验)
- [x] 字幕条可拖拽:`data-tauri-drag-region` + `core:window:allow-start-dragging`;退出改为右键/Esc(左键留给拖拽)。位置在会话内(hide/show)保持
- [x] 录音落盘:设置勾选"保存录音" → 会话期间把 16k/mono PCM 写成 WAV 到 `<appDataDir>/recordings/rec-<ms>.wav`,停止时回填头并在状态栏提示路径。与 WS 独立,断线期间照常录

---

## Review (S1)

**完成**:类型扩展、`src/asr.ts`、`/asr/transcribe` 路由、tsc 零错、dev server 启动 OK、negative path 三种全通。

**延后**:admin UI alinls tab 和 `testEndpoint` case 推到 S2 一起做。原因是 alinls 的字段集(lyBlue/AK/SK/AppKey)和现有 LLM provider 共用的 `buildCard` 形态差异大,强行复用会让 UI 代码污染严重。S2 单独写 `buildAlinlsCard` 更干净。

**待验证**:positive path 需要 ly-blue 真实凭证,我无法自测;SOP 已写好。

**踩坑**:
- 一开始没 export `verifyToken/selectEndpoint/isLogsEnabled`(都是 file-local 函数),asr.ts 写完才发现需要复用。补了 export,无副作用。
- `buildUpstreamRequest` 的 switch 在 ProviderName 加 `"alinls"` 后,TS 因 default case 缺失无法证明 `targetUrl` 已赋值。补 `default: throw` 兜底,因为 router 已经把 alinls 拦截走 `/asr/*`,这里 unreachable。

## Lessons

(等 positive 验收后再加,可能涉及阿里云签名/编码、Workers SubtleCrypto vs nodejs crypto 的差异)

