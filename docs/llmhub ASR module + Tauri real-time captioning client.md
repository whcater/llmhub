# llmhub ASR 模块 + Tauri 实时字幕客户端

## Context

`C:\dev\lab\reverse\recordIdentify` 通过反编译 Android app `com.lb.recordIdentify` 跑通了**阿里云 NLS 4 步调用链**:`ly-blue.lx86.net` 取 Bearer → 取 Ali AK/SK → nls-meta 换 NLS Token → 调 FlashRecognizer (短音频 REST) 或 SpeechTranscriber (实时 WS)。两个 Python 入口能用,但绑定 Windows + 不能多端共享。

目标:
1. 把 ASR 能力封装成易用 API 收进当前 `llmhub` (Cloudflare Workers 网关),由 CF 持有所有上游凭证,**客户端只持 LLMHub Bearer token,绝不下发 NLS Token**。
2. 用 Tauri 2 + Rust 做新客户端,跨平台采音频,通过新 API 拿字幕。

**两阶段凭证策略**(用户决策):
- Phase A:先复用 ly-blue 链路调通端到端架构(注意合规边界,**部署不公开 URL + 强 Bearer**)
- Phase B:切到我自己的阿里云 NLS 账号(完全合规,可商用)。Phase B 只换 endpoint 配置,不动业务代码。

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tauri Client (Rust)                       │
│  音频源(cpal/WASAPI/SCK/Pulse) → PCM 16k mono                    │
│              │                                                   │
│              ├──► HTTPS POST /asr/transcribe (短音频)            │
│              └──► WSS    /asr/stream       (实时,二进制 PCM 帧)  │
└──────────────┼──────────────────────────────────────────────────┘
               │  Bearer: <LLMHub auth_token>
               ▼
┌─────────────────────────────────────────────────────────────────┐
│              llmhub  (Cloudflare Workers)                        │
│                                                                  │
│  /asr/transcribe  → verifyToken → asr.handleTranscribe()         │
│                       ├─ nlsTokenManager.get() (KV 缓存 23h)     │
│                       └─ fetch FlashRecognizer (REST,音频 body) │
│                                                                  │
│  /asr/stream      → verifyToken → asr.handleStream()             │
│                       ├─ WebSocketPair() 接客户端                │
│                       ├─ fetch wss://nls-gateway.../ws/v1        │
│                       │   {headers:{Upgrade:'websocket'}} → ws   │
│                       ├─ resp.webSocket.accept({allowHalfOpen})  │
│                       └─ 双向桥接 (binary PCM 转发, JSON 控制帧) │
│                                                                  │
│  /admin/...        已有,新增 asr provider tab                   │
└──────────────┬──────────────────────────────────────────────────┘
               │
               ▼
   ly-blue.lx86.net (Phase A) ─── 取 AK/SK,缓存到 KV
   nls-meta.cn-shanghai.aliyuncs.com ── HMAC-SHA1 签名取 NLS Token
   nls-gateway.cn-shanghai.aliyuncs.com (REST + WS)
```

**关键决策:NLS Token 永不下发**
- Token 只存在 Worker 内存/KV
- 实时 WS:Worker 自己握手时把 `?token=` 拼到 nls-gateway URL,客户端的 WS URL 只有 `wss://<llmhub>/asr/stream`
- REST:Worker 自己加 `token` query 后转发到 nls-gateway

---

## 二、Phase A 后端实现 (llmhub)

### 2.1 文件清单 + 改动

| 文件 | 改动 |
|---|---|
| `src/types.ts` | 在 `ProviderName` 加 `"alinls"`;加 `AlinlsConfig` 接口(语种映射、AK/SK、ly-blue 凭证) |
| `src/index.ts:464` | 入口 `fetch` 在分发 provider proxy 前,先匹配 `/asr/transcribe` / `/asr/stream`,路由到新 `handleAsr` |
| `src/asr.ts` **(新)** | `handleTranscribe()` + `handleStream()` + `NlsTokenManager` + `LyBlueClient`(从 `recog.py` 翻译) |
| `src/admin.ts:214 runTest` | 加 `case "alinls"`:把 `sample.mp3` (base64 内嵌一小段)发到 FlashRecognizer 验证整链 |
| `src/admin.ts:5` `SUPPORTED_PROVIDERS` | 加 `"alinls"` |
| `src/ui.ts` | 加 alinls tab(字段:lyBlueBearerToken/lyBlueOaid/aliAccessKeyId/aliAccessKeySecret/nlsAppKey/lang) |
| `src/logger.ts` | 复用现有 `writeRequestLog`/`writeResponseLog`,**WS 隧道额外**写 `logs/{hr}/{reqId}_ws` 汇总(发送字节数/接收 sentence 数/duration) |
| `test/requests/asr.http` **(新)** | 调通用例:`curl --data-binary @sample.mp3 -H "Authorization: Bearer ..." /asr/transcribe` |

### 2.2 KV schema 新增

| key | 内容 | TTL |
|---|---|---|
| `provider:alinls` | `{endpoints:[{lyBlueBearerToken, lyBlueOaid, aliAccessKeyId, aliAccessKeySecret, nlsAppKey, lang, enabled}], strategy}` | 永久 |
| `asr:nls_token` | `{token, ak, expireAt}` Token 缓存(避免每次都签 HMAC) | 23h |

> `provider:alinls.endpoints` 复用 `Endpoint` 结构(`apiKey` 字段塞 `aliAccessKeySecret`,其他塞 `query` JSON 或新增可选字段)。简单起见:在 `Endpoint` 增加几个**可选**字段 `aliAccessKeyId?`/`nlsAppKey?`/`lyBlueBearerToken?`/`lyBlueOaid?`,Phase B 切自己阿里云时把 lyBlue 两项留空、AK/SK 直接填即可,无需迁移。

### 2.3 `src/asr.ts` 核心 API

```ts
// ── Token 取/缓存 ────────────────────────────────────
class NlsTokenManager {
  // 先读 KV asr:nls_token; 没过期返回; 过期则:
  //   优先用 endpoint 已配的 AK/SK 调 nls-meta CreateToken
  //   若 endpoint 只配了 lyBlue,先调 /api/v1/get_ali_ly_blue_config 拿 AK/SK 再签
  // 签名:照搬 nls_auth.py:113 get_nls_token(HMAC-SHA1, URLEncode RFC3986 + "~")
  async get(endpoint: Endpoint, env: Env): Promise<{token: string, appKey: string}>
}

// ── REST: 短音频 ─────────────────────────────────────
async function handleTranscribe(req: Request, env: Env, ctx: ExecutionContext) {
  // 1. verifyToken (复用 index.ts:21)
  // 2. selectEndpoint("alinls", env) (复用 index.ts:108)
  // 3. const {token, appKey} = await tokenMgr.get(endpoint, env)
  // 4. const format = req.headers.get("X-Audio-Format") ?? "MP3"  // MP3/WAV/PCM/AAC/OPUS
  // 5. const sampleRate = req.headers.get("X-Sample-Rate") ?? "16000"
  // 6. const lang = req.url.searchParams.get("lang") ?? "0"  // 同 recog.py --lang
  // 7. fetch(`http://nls-gateway.../FlashRecognizer?appkey=${appKey}&token=${token}&format=${format}&sample_rate=${sampleRate}`,
  //         {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body: req.body})
  // 8. 解析 res.flash_result.sentences,标准化:
  //    {sentences:[{begin:s, end:s, text}], full:"全文"}
  // 9. writeRequestLog/writeResponseLog (复用 logger.ts)
}

// ── WS: 实时字幕 ─────────────────────────────────────
async function handleStream(req: Request, env: Env, ctx: ExecutionContext) {
  // 0. 校验 Bearer (WS 升级请求只能用 query string 或 cookie,
  //    客户端用 wss://<host>/asr/stream?token=<LLMHub bearer>)
  if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WS', {status:426});

  // 1. 拿 NLS token / appKey
  const {token, appKey} = await tokenMgr.get(endpoint, env);

  // 2. 接客户端 WS
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  // 3. 拨出 upstream WS (fetch + Upgrade)
  const upstreamResp = await fetch(
    `https://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1?token=${token}`,
    {headers: {Upgrade: 'websocket'}}
  );
  const upstream = upstreamResp.webSocket!;
  upstream.accept({allowHalfOpen: true});

  // 4. 客户端 → 阿里云
  //    JSON 控制帧由 client 发(StartTranscription/StopTranscription),Worker 透传
  //    但要注入 task_id/appkey:可让客户端不发 start,改由 Worker 收到首个二进制帧时自动发 start
  let started = false;
  server.addEventListener('message', (e) => {
    if (typeof e.data === 'string') {
      // 透传 JSON,但拦截 StartTranscription 把 appkey 注入
      const j = JSON.parse(e.data);
      if (j.header?.name === 'StartTranscription') j.header.appkey = appKey;
      upstream.send(JSON.stringify(j));
    } else {
      // PCM binary 直接转发
      upstream.send(e.data);
    }
  });

  // 5. 阿里云 → 客户端 (原样转发,客户端按 SentenceEnd/TranscriptionResultChanged 解析)
  upstream.addEventListener('message', (e) => server.send(e.data));
  upstream.addEventListener('close', (e) => server.close(e.code, e.reason));
  server.addEventListener('close', () => upstream.close());

  return new Response(null, {status: 101, webSocket: client});
}
```

### 2.4 路由接入 (`src/index.ts`)

```ts
// 在 src/index.ts:467 (path 判断块) 加:
if (path === '/asr/transcribe') return handleAsrTranscribe(request, env, ctx);
if (path === '/asr/stream')     return handleAsrStream(request, env, ctx);
```

### 2.5 长音频(>2 分钟)— 客户端切片

**决策:不在 Worker 端切片**(CF Worker 30s CPU 限制 + 不想拉文件解码依赖)。客户端用 Rust `symphonia` decode → 按 60s 切片 → 并发 N=3 调 `/asr/transcribe` → 合并并以片偏移修正 sentence 时间戳。客户端实现成本可控,且对超长会议(>20 分钟)更友好。

---

## 三、Tauri 客户端 (cross-platform)

### 3.1 项目骨架

```
recordIdentify-tauri/   (新仓库 / monorepo 子目录,跟 llmhub 解耦)
├── src-tauri/
│   ├── Cargo.toml         # tauri, tokio, tokio-tungstenite, cpal, symphonia, reqwest
│   ├── src/
│   │   ├── main.rs
│   │   ├── audio/
│   │   │   ├── mod.rs       # trait AudioSource { start/stop/list_devices }
│   │   │   ├── windows.rs   # cfg(target_os="windows") WASAPI loopback (cpal)
│   │   │   ├── macos.rs     # cfg(target_os="macos") ScreenCaptureKit (screencapturekit-rs)
│   │   │   └── linux.rs     # cfg(target_os="linux") PulseAudio monitor (cpal default)
│   │   ├── asr/
│   │   │   ├── rest.rs      # POST /asr/transcribe
│   │   │   ├── stream.rs    # WSS /asr/stream + reconnect (照搬 live_caption.py:NlsStreamingClient:268)
│   │   │   └── chunker.rs   # 长音频切片 + 时间戳合并
│   │   └── config.rs        # llmhub_base_url, auth_token, audio_device_index 等
│   └── tauri.conf.json
├── src/                     # Vue / Svelte / React,无所谓 — 字幕条 + 全文页两个组件
│   ├── App.tsx
│   ├── components/
│   │   ├── CaptionBar.tsx   # 字幕模式 (always-on-top 半透明)
│   │   └── FullText.tsx     # 全文模式
│   └── ipc.ts               # invoke('start_capture'), listen('partial'/'sentence'/'status')
└── package.json
```

### 3.2 跨平台音频统一接口

```rust
// src-tauri/src/audio/mod.rs
pub trait AudioSource: Send {
    fn list_devices() -> Vec<DeviceInfo>;  // (index, name, is_loopback, sr, ch)
    fn start(&mut self, device: Option<u32>, on_pcm: Box<dyn Fn(&[i16]) + Send>) -> Result<()>;
    fn pause(&mut self);  fn resume(&mut self);  fn stop(&mut self);
}
```

| 平台 | 实现 | 备注 |
|---|---|---|
| Windows | `cpal` WASAPI host + `supported_input_configs` 里挑 loopback 设备(`cpal` 最新版已暴露 IMMDevice) | 主路径,已被 `live_caption.py` 验证 |
| Mac | `screencapturekit-rs` crate(macOS 13+);降级方案:仅麦克风 (`cpal` CoreAudio) | macOS 14.6+ 才能用 `cpal` 原生 loopback,先用 SCK |
| Linux | `cpal` PulseAudio feature + `device_id = "@DEFAULT_MONITOR@"` | pipewire monitor source 同理 |

每个实现内部统一:**输入采样率 → 重采样到 16k mono int16 → 200ms chunk → 通过 `on_pcm` 推出**。重采样用 `rubato` crate(或简单 decimate,跟 `live_caption.py:142` 的 `pcm[::ratio]` 等价)。

### 3.3 实时流式核心 (`src-tauri/src/asr/stream.rs`)

照搬 `live_caption.py:NlsStreamingClient:157` 的状态机,但**目标 URL 是 `wss://<llmhub>/asr/stream?token=<auth_token>`**,不再是 nls-gateway。

- 连接 → 发 `StartTranscription` JSON(不带 token/appkey,llmhub 注入)
- 喂 PCM(binary frame)
- 收 `TranscriptionResultChanged` → emit Tauri event `asr://partial`
- 收 `SentenceEnd` → emit `asr://sentence`
- 断线 → 指数退避重连(2-15s,最多 6 次)
- Tauri 前端用 `listen('asr://sentence', cb)` 渲染字幕

### 3.4 UI 复刻 `live_caption.py` 双模式

- **全文模式**:标准窗口,时间戳 + 句子滚动 + 顶栏按钮(切模式/暂停/复制/清空/设备选择)
- **字幕模式**:`always_on_top + decorations:false + transparent:true` 的副窗口,屏幕底部半透明,3-5 句滚动
- Tauri 2 都支持(`WebviewWindowBuilder`),比 tkinter 干净一截

---

## 四、关键文件 / 代码引用(实施时要看)

| 我要写的 | 参考源 | 行号 |
|---|---|---|
| `asr.ts` REST 转发 | `recog.py:flash_recognize` | 25-38 |
| `asr.ts` NLS Token 签名 | `nls_auth.py:get_nls_token` | 113-133 |
| `asr.ts` ly-blue 取 AK/SK | `nls_auth.py:get_ali_config` | 96-104 |
| `asr.ts` 鉴权/选 endpoint | `src/index.ts:verifyToken / selectEndpoint` | 21,108 |
| `asr.ts` WS 接客户端 + outbound | CF docs `WebSocketPair` + `fetch{Upgrade}` | (新写) |
| `asr.ts` 写日志 | `src/logger.ts:writeRequestLog/writeResponseLog` | 83,115 |
| Tauri `audio/windows.rs` | `live_caption.py:AudioCapture._run` | 115-153 |
| Tauri `asr/stream.rs` | `live_caption.py:NlsStreamingClient` | 157-297 |
| Tauri 双窗口 UI | `live_caption.py:CaptionUI` | 302-536 |
| admin UI alinls tab | `src/ui.ts` 现有 provider tab(参照 anthropic 行) | grep "anthropic" |

---

## 五、验证 (E2E test plan)

### Phase A 后端
1. `wrangler kv key put provider:alinls '<json with ly-blue creds>'` (拷贝 `config.json` 的 bearer_token + oaid)
2. `npm run dev` → `curl -X POST http://localhost:8788/asr/transcribe?lang=0 -H "Authorization: Bearer <auth_token>" -H "X-Audio-Format: MP3" --data-binary @C:/dev/lab/reverse/recordIdentify/sample.mp3` 应返回 sentences[]
3. WS:用 `wscat -c "ws://localhost:8788/asr/stream?token=<auth_token>"` 发 StartTranscription JSON,再用 `recordIdentify` 的 PCM 文件喂帧,应收到 TranscriptionResultChanged
4. admin UI 中点"测试 alinls" 应跑通 sample 验证

### Phase A 客户端 (Windows 先行)
1. `cargo tauri dev` 启动
2. 选系统默认 loopback,播 B 站视频,应在 3 秒内出字幕
3. 关闭网络 5 秒再恢复 → 自动重连
4. 短音频:GUI 拖个 mp3 到全文窗 → 调 `/asr/transcribe` → sentences 入栏

### Phase A 部署 + 合规
- `wrangler deploy` 部署
- 自定义域名,**不在 README 写**,不公开 endpoint
- LLMHub Bearer 不写进 Tauri 代码(由用户首次启动手工输入,存 OS keychain)
- 客户端跑 1 小时连续会议,确认 NLS Token 在 23h 边界自动刷新(KV cache 失效)

### Phase B 切换 (后续)
1. 自己阿里云控制台 → 智能语音交互 → 拿 AK/SK + AppKey
2. admin UI 编辑 alinls endpoint,清空 lyBlue 字段,填上自己的 AK/SK/AppKey
3. 重跑步骤 1-3 — 客户端零改动

---

## 六、风险 / 未解决问题

1. **CF Workers WS 计费**:实时长连接按 wall-clock + CPU time 计费;outbound WS **不支持 hibernation**。1 小时连续会议 ≈ 持续占用一个 isolate。要么接受成本,要么后续迁到 Durable Object(可 hibernate inbound,但 outbound 仍持续)。
2. **CF Workers WS 单次时长**:免费版 30s wall-clock 限制不适用于 WS(WS 升级后按 duration 计)。付费版没硬限。需要在客户端做"主动重连"兜底,保证 1 小时连不上限。
3. **Mac 屏幕录制权限**:ScreenCaptureKit 首次启动会弹"屏幕录制权限"——和 macOS 系统音频捕获的统一行为,无解,UI 上提示用户即可。
4. **Linux PulseAudio vs PipeWire**:用户系统差异大。先只测 PulseAudio + PipeWire 的 `pulse` 桥接,ALSA 直连不支持。
5. **ly-blue token 49 天后过期**:`acquire_bearer` 失败时 Worker 自动 fallback 到 `temporary_login`(匿名),并在 logs 留 warning。
6. **AK/SK 出现在 CF KV**:Phase A 是事实上的"代为持有他人凭证",法律边界灰。**Phase B 应尽快完成**。CLAUDE.md 第 3 条:精准修改 —— 但这里凭证管理是新建,不算扩展。

---

## 七、阶段拆分(Sprint 粒度)

| Sprint | 范围 | 验收 |
|---|---|---|
| **S1** | `src/asr.ts` + `/asr/transcribe` + admin alinls tab + KV schema + 测试用例 | curl sample.mp3 返回 sentences |
| **S2** | `/asr/stream` WS 隧道 + Token 缓存 + 日志 | wscat 联调出实时字幕 |
| **S3** | Tauri 骨架 + Windows WASAPI + 实时字幕双模式 UI | 看 B 站视频出字幕 |
| **S4** | Tauri 短音频(REST) + 长音频客户端切片 | 拖 5 分钟 mp3 出完整字幕 |
| **S5** | Tauri Mac (SCK) | Mac 听网课出字幕 |
| **S6** | Tauri Linux (Pulse monitor) | Linux 听 YouTube 出字幕 |
| **S7** | Phase B:切自己阿里云账号 + 下线 ly-blue 字段 | 全链零改动跑通 |

实施时按 CLAUDE.md 工作流:每个 Sprint 先把任务写到 `tasks/todo.md` 勾选式条目,完成后在末尾补 review,踩坑写到 `tasks/lessons.md`。

---

## 八、不在范围内 (明确放弃)

- 服务端切片长音频(交客户端)
- VAD / 降噪(交客户端,后续可加)
- 多语种自动检测(用户选 lang 参数,初版固定中文普通话)
- iOS/Android 客户端(Tauri 桌面优先,移动端是 S8+)
- WS hibernation 优化(等 CF 支持 outbound hibernation 再做)
- 重写 ly-blue 鉴权为更细粒度(直接搬 Python 逻辑)
