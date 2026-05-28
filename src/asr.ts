// ASR 模块: 录音文字提取 (阿里云 NLS) 接入
// 链路 (照搬自 C:\dev\lab\reverse\recordIdentify\recog.py + nls_auth.py):
//   ① (可选) ly-blue.lx86.net 取 Ali AK/SK + NLS AppKey
//   ② nls-meta.cn-shanghai.aliyuncs.com 签 CreateToken 拿 NLS Token (24h)
//   ③ nls-gateway.cn-shanghai.aliyuncs.com/.../FlashRecognizer 转写音频
//
// 凭证策略 (两阶段):
//   Phase A: endpoint 配 lyBlueBearerToken + lyBlueOaid, 运行时拉 AK/SK
//   Phase B: endpoint 直接配 aliAccessKeyId + apiKey(SK) + nlsAppKey, 不走 ly-blue
//
// NLS Token 仅留在 Worker 内, 不下发给客户端.

import type { Env, Endpoint } from "./types";
import { verifyToken, selectEndpoint, isLogsEnabled } from "./index";
import { writeRequestLog, writeResponseLog, type RequestLogData, type ResponseLogData } from "./logger";

const LY_BLUE_BASE = "https://ly-blue.lx86.net";
const NLS_META = "https://nls-meta.cn-shanghai.aliyuncs.com";
const NLS_GATEWAY_REST = "https://nls-gateway.cn-shanghai.aliyuncs.com/stream/v1/FlashRecognizer";
const NLS_TOKEN_KV_KEY = "asr:nls_token";
const NLS_TOKEN_TTL_SEC = 23 * 60 * 60; // 阿里云 token 24h, 我们提前 1h 刷

// ── helpers ──────────────────────────────────────────────────────────

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// 阿里云 RFC3986 URL 编码: `~` 不编码 (照 Python `urllib.parse.quote(s, safe="~")`)
function aliyunUrlEncode(s: string): string {
	return encodeURIComponent(s)
		.replace(/!/g, "%21")
		.replace(/\*/g, "%2A")
		.replace(/'/g, "%27")
		.replace(/\(/g, "%28")
		.replace(/\)/g, "%29");
	// `~` 默认不被 encodeURIComponent 编码, 正好对应 Python 的 safe="~"
}

function bufToBase64(buf: ArrayBuffer): string {
	let bin = "";
	const bytes = new Uint8Array(buf);
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}

function uuidHex(): string {
	const buf = new Uint8Array(16);
	crypto.getRandomValues(buf);
	let out = "";
	for (let i = 0; i < buf.length; i++) out += buf[i].toString(16).padStart(2, "0");
	return out;
}

// ── ly-blue: 取 AK/SK + AppKey ──────────────────────────────────────

function lyBlueHeaders(bearer?: string, oaid?: string): Record<string, string> {
	const h: Record<string, string> = {
		oaid: oaid ?? "",
		deviceNo: oaid ?? "",
		deviceType: "1",
		phoneBrand: "Xiaomi",
		phoneModel: "25060RK16C",
		versionCode: "1431",
		versionName: "14.3.1",
		channel: "4437",
		productNum: "0001",
		markId: "",
		"User-Agent": "okhttp/4.9.3",
	};
	if (bearer) h.Authorization = `Bearer ${bearer}`;
	return h;
}

async function lyBlueTemporaryLogin(oaid: string): Promise<string> {
	const form = new URLSearchParams({ productNum: "0001", markId: "" });
	const r = await fetch(`${LY_BLUE_BASE}/api/v1/temporary_login`, {
		method: "POST",
		headers: { ...lyBlueHeaders(undefined, oaid), "Content-Type": "application/x-www-form-urlencoded" },
		body: form.toString(),
	});
	if (!r.ok) throw new Error(`ly-blue temporary_login HTTP ${r.status}`);
	const j: any = await r.json();
	if (j.code !== 200) throw new Error(`ly-blue temporary_login fail: ${JSON.stringify(j)}`);
	return j.data.token as string;
}

async function lyBlueGetAliConfig(bearer: string, oaid: string): Promise<{ ak: string; sk: string; appKey: string }> {
	const r = await fetch(`${LY_BLUE_BASE}/api/v1/get_ali_ly_blue_config`, {
		method: "POST",
		headers: { ...lyBlueHeaders(bearer, oaid), "Content-Type": "application/x-www-form-urlencoded" },
		body: "",
	});
	if (!r.ok) throw new Error(`ly-blue get_ali_config HTTP ${r.status}`);
	const j: any = await r.json();
	if (j.code !== 200) throw new Error(`ly-blue get_ali_config fail: ${JSON.stringify(j)}`);
	const d = j.data[0];
	// 默认取第 0 个语种 (普通话)
	return {
		ak: d.ali_access_key_id as string,
		sk: d.ali_access_key_secret as string,
		appKey: d.voice_page[0].language[0].key as string,
	};
}

// ── 阿里云 NLS CreateToken (HMAC-SHA1 + RFC3986) ────────────────────

async function nlsCreateToken(ak: string, sk: string): Promise<string> {
	const params: Record<string, string> = {
		AccessKeyId: ak,
		Action: "CreateToken",
		Format: "JSON",
		RegionId: "cn-shanghai",
		SignatureMethod: "HMAC-SHA1",
		SignatureNonce: uuidHex(),
		SignatureVersion: "1.0",
		Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
		Version: "2019-02-28",
	};
	const sortedKeys = Object.keys(params).sort();
	const qs = sortedKeys.map((k) => `${aliyunUrlEncode(k)}=${aliyunUrlEncode(params[k])}`).join("&");
	const stringToSign = `GET&${aliyunUrlEncode("/")}&${aliyunUrlEncode(qs)}`;

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(sk + "&"),
		{ name: "HMAC", hash: "SHA-1" },
		false,
		["sign"],
	);
	const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
	const signature = bufToBase64(sigBuf);

	const finalParams = new URLSearchParams({ ...params, Signature: signature });
	const r = await fetch(`${NLS_META}/?${finalParams.toString()}`);
	if (!r.ok) {
		const text = await r.text().catch(() => "");
		throw new Error(`NLS CreateToken HTTP ${r.status}: ${text}`);
	}
	const j: any = await r.json();
	if (!j.Token?.Id) throw new Error(`NLS CreateToken fail: ${JSON.stringify(j)}`);
	return j.Token.Id as string;
}

// ── NlsTokenManager: 取/缓存 NLS Token + AppKey ─────────────────────

export interface NlsTokenBundle {
	token: string;
	appKey: string;
}

interface CachedToken {
	token: string;
	ak: string;       // 标识缓存归属哪个 ak (换 endpoint 时需要失效)
	expireAt: number; // epoch ms
	appKey: string;
}

async function resolveAkSk(
	endpoint: Endpoint,
): Promise<{ ak: string; sk: string; appKey: string }> {
	// Phase B: endpoint 直接配了 AK/SK/AppKey
	if (endpoint.aliAccessKeyId && endpoint.apiKey && endpoint.nlsAppKey) {
		return { ak: endpoint.aliAccessKeyId, sk: endpoint.apiKey, appKey: endpoint.nlsAppKey };
	}
	// Phase A: 从 ly-blue 拉
	if (!endpoint.lyBlueOaid) {
		throw new Error("alinls endpoint misconfigured: need either {aliAccessKeyId+apiKey+nlsAppKey} or {lyBlueBearerToken+lyBlueOaid}");
	}
	let bearer = endpoint.lyBlueBearerToken;
	if (!bearer) {
		// 匿名 fallback
		bearer = await lyBlueTemporaryLogin(endpoint.lyBlueOaid);
	}
	try {
		return await lyBlueGetAliConfig(bearer, endpoint.lyBlueOaid);
	} catch (e) {
		// 配置的 bearer 可能过期, 再 fallback 一次
		if (endpoint.lyBlueBearerToken) {
			const anon = await lyBlueTemporaryLogin(endpoint.lyBlueOaid);
			return await lyBlueGetAliConfig(anon, endpoint.lyBlueOaid);
		}
		throw e;
	}
}

export async function getNlsToken(endpoint: Endpoint, env: Env): Promise<NlsTokenBundle> {
	// 先看缓存
	const raw = await env.LLMHUB_KV.get(NLS_TOKEN_KV_KEY);
	if (raw) {
		try {
			const cached = JSON.parse(raw) as CachedToken;
			// 用 ak 作为缓存键的一部分语义: 如果 endpoint 切到不同账号, 缓存自动失效
			if (cached.expireAt > Date.now() + 60_000) {
				// Phase B 直配 AK 时校验 ak 是否一致
				const directAk = endpoint.aliAccessKeyId;
				if (!directAk || directAk === cached.ak) {
					return { token: cached.token, appKey: cached.appKey };
				}
			}
		} catch {}
	}
	// miss / 过期 → 重新签
	const { ak, sk, appKey } = await resolveAkSk(endpoint);
	const token = await nlsCreateToken(ak, sk);
	const bundle: CachedToken = {
		token,
		ak,
		appKey,
		expireAt: Date.now() + NLS_TOKEN_TTL_SEC * 1000,
	};
	await env.LLMHUB_KV.put(NLS_TOKEN_KV_KEY, JSON.stringify(bundle), {
		expirationTtl: NLS_TOKEN_TTL_SEC,
	});
	return { token, appKey };
}

// ── REST: /asr/transcribe (FlashRecognizer 短音频, ≤2 分钟) ─────────

interface AsrSentence {
	begin: number; // seconds
	end: number;
	text: string;
}

interface AsrResult {
	sentences: AsrSentence[];
	full: string;
	taskId?: string;
	upstreamStatus?: number;
}

export async function handleAsrTranscribe(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const startTime = Date.now();
	const logsEnabled = await isLogsEnabled(env);
	const requestId = logsEnabled
		? `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
		: "";

	if (logsEnabled) {
		const requestLogData: RequestLogData = {
			timestamp: new Date().toISOString(),
			method: request.method,
			path: new URL(request.url).pathname,
			headers: Object.fromEntries(request.headers.entries()),
			body: undefined, // 二进制音频不写日志体
			query: new URL(request.url).search,
			ip: request.headers.get("cf-connecting-ip") || undefined,
			userAgent: request.headers.get("user-agent") || undefined,
			requestId,
		};
		ctx.waitUntil(writeRequestLog(env.LLMHUB_KV, requestLogData));
	}

	const logEarly = (status: number, errorBody: any) => {
		if (!logsEnabled) return;
		ctx.waitUntil(writeResponseLog(env.LLMHUB_KV, {
			timestamp: new Date().toISOString(),
			status,
			responseTime: Date.now() - startTime,
			body: errorBody,
			requestId,
		}));
	};

	if (request.method !== "POST") {
		const err = { error: "Method not allowed" };
		logEarly(405, err);
		return jsonResponse(err, 405);
	}

	const authErr = await verifyToken(request, env);
	if (authErr) {
		const cloned = authErr.clone();
		let body: any;
		try { body = await cloned.json(); } catch {}
		logEarly(authErr.status, body);
		return authErr;
	}

	const selection = await selectEndpoint("alinls", env);
	if (!selection) {
		const err = { error: "No available endpoint for provider: alinls" };
		logEarly(503, err);
		return jsonResponse(err, 503);
	}

	const url = new URL(request.url);
	// 音频格式 / 采样率: query > header > default
	const format = (url.searchParams.get("format") || request.headers.get("x-audio-format") || "MP3").toUpperCase();
	const sampleRate = url.searchParams.get("sample_rate") || request.headers.get("x-sample-rate") || "16000";

	let bundle: NlsTokenBundle;
	try {
		bundle = await getNlsToken(selection.endpoint, env);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		const err = { error: `Failed to acquire NLS token: ${msg}` };
		logEarly(502, err);
		return jsonResponse(err, 502);
	}

	// 转发音频 body 到 FlashRecognizer
	const upstreamUrl = new URL(NLS_GATEWAY_REST);
	upstreamUrl.searchParams.set("appkey", bundle.appKey);
	upstreamUrl.searchParams.set("token", bundle.token);
	upstreamUrl.searchParams.set("format", format);
	upstreamUrl.searchParams.set("sample_rate", sampleRate);

	// 读完整 body (短音频, 一般 <2MB)
	const audio = await request.arrayBuffer();
	if (audio.byteLength === 0) {
		const err = { error: "Empty audio body" };
		logEarly(400, err);
		return jsonResponse(err, 400);
	}

	let upstream: Response;
	try {
		upstream = await fetch(upstreamUrl.toString(), {
			method: "POST",
			headers: {
				"Content-Type": "application/octet-stream",
				"Content-Length": String(audio.byteLength),
			},
			body: audio,
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		const err = { error: `Upstream fetch failed: ${msg}` };
		logEarly(502, err);
		return jsonResponse(err, 502);
	}

	let upstreamJson: any;
	try {
		upstreamJson = await upstream.json();
	} catch (e) {
		const err = { error: "Upstream returned non-JSON response", status: upstream.status };
		logEarly(502, err);
		return jsonResponse(err, 502);
	}

	if (upstreamJson.status !== 20000000) {
		const err = {
			error: "Upstream ASR failed",
			upstream: upstreamJson,
		};
		logEarly(502, err);
		return jsonResponse(err, 502);
	}

	const rawSentences: any[] = upstreamJson.flash_result?.sentences ?? [];
	const sentences: AsrSentence[] = rawSentences.map((s: any) => ({
		begin: (s.begin_time ?? 0) / 1000,
		end: (s.end_time ?? 0) / 1000,
		text: String(s.text ?? ""),
	}));
	const result: AsrResult = {
		sentences,
		full: sentences.map((s) => s.text).join(""),
		taskId: upstreamJson.task_id,
		upstreamStatus: upstreamJson.status,
	};

	if (logsEnabled) {
		ctx.waitUntil(writeResponseLog(env.LLMHUB_KV, {
			timestamp: new Date().toISOString(),
			status: 200,
			responseTime: Date.now() - startTime,
			body: {
				sentenceCount: sentences.length,
				audioBytes: audio.byteLength,
				preview: result.full.slice(0, 200),
			},
			requestId,
		}));
	}

	return jsonResponse(result);
}
