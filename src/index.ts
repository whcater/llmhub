import type { Env, Endpoint, ProviderConfig, ProviderName, SelectionStrategy } from "./types";
import { SUPPORTED_PROVIDERS, DEFAULT_STRATEGY, DEFAULT_VERSION } from "./types";
import { handleAdmin } from "./admin";
import { handleAsrTranscribe } from "./asr";
import {
	writeRequestLog,
	writeResponseLog,
	parseSSEStreamForLog,
	type RequestLogData,
	type ResponseLogData
} from "./logger";


const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

// ── Auth middleware ──────────────────────────────────────────────────

export async function verifyToken(request: Request, env: Env): Promise<Response | null> {
	const authToken = await env.LLMHUB_KV.get("auth_token");
	if (!authToken) {
		return jsonResponse({ error: "Service not configured: auth_token missing in KV" }, 503);
	}

	const authorization = request.headers.get("Authorization");
	const xApiKey = request.headers.get("x-api-key");

	if (!authorization?.startsWith("Bearer ") && !xApiKey) {
		return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
	}

	const token = xApiKey ?? authorization?.slice(7);

	if (token !== authToken) {
		return jsonResponse({ error: "Invalid token" }, 403);
	}

	return null; // passed
}

// ── Endpoint selection ────────────────────────────────────────────────

// In-memory state (per-isolate, resets on cold start)
const rrCounters = new Map<string, number>();
const stickyIndex = new Map<string, number>(); // for failover-on-error

function maskKey(key: string): string {
	if (!key) return "";
	if (key.length <= 12) return key;
	return key.slice(0, 6) + "..." + key.slice(-4);
}

function selectByStrategy(
	enabled: Endpoint[],
	strategy: SelectionStrategy,
	provider: string,
): Endpoint {
	switch (strategy) {
		case "failover-on-error": {
			// Stick with current index until error triggers advance
			const idx = (stickyIndex.get(provider) ?? 0) % enabled.length;
			return enabled[idx];
		}

		case "round-robin": {
			const idx = (rrCounters.get(provider) ?? 0) % enabled.length;
			rrCounters.set(provider, idx + 1);
			return enabled[idx];
		}

		case "random":
			return enabled[Math.floor(Math.random() * enabled.length)];

		case "failover":
			return enabled[0];

		case "weighted": {
			const weights = enabled.map((e) => e.weight ?? 1);
			const total = weights.reduce((a, b) => a + b, 0);
			let r = Math.random() * total;
			for (let i = 0; i < enabled.length; i++) {
				r -= weights[i];
				if (r <= 0) return enabled[i];
			}
			return enabled[enabled.length - 1];
		}

		default:
			return enabled[Date.now() % enabled.length];
	}
}

function advanceStickyIndex(provider: string, enabledCount: number): number {
	const prev = stickyIndex.get(provider) ?? 0;
	const next = (prev + 1) % enabledCount;
	stickyIndex.set(provider, next);
	return next;
}

export interface EndpointSelection {
	endpoint: Endpoint;
	enabled: Endpoint[];
	strategy: SelectionStrategy;
}

export async function selectEndpoint(provider: ProviderName, env: Env): Promise<EndpointSelection | null> {
	const raw = await env.LLMHUB_KV.get(`provider:${provider}`);
	if (!raw) return null;

	const config: ProviderConfig = JSON.parse(raw);
	const enabled = config.endpoints.filter((e) => e.enabled);
	if (enabled.length === 0) return null;

	const strategy = config.strategy ?? DEFAULT_STRATEGY;
	return { endpoint: selectByStrategy(enabled, strategy, provider), enabled, strategy };
}


function formatBytes(value: string | null): string {
	const bytes = value ? parseInt(value, 10) : 0;
	if (bytes === 0) return '0 B';
	return `${(bytes/1024).toFixed(2)} KB`;
}

export async function isLogsEnabled(env: Env): Promise<boolean> {
	return (await env.LLMHUB_KV.get("logs_enabled")) === "true";
}

// Rewrite the leading version segment of subPath when it differs from the configured version.
// Only first segments shaped like /v1, /v2, /v1beta, /v2alpha are treated as versions.
function applyVersionOverride(subPath: string, configuredVersion: string): string {
	const m = subPath.match(/^\/(v[a-zA-Z0-9]+)(\/.*)?$/);
	if (!m) return subPath;
	const requestVersion = m[1];
	const rest = m[2] ?? "";
	if (requestVersion === configuredVersion) return subPath;
	return `/${configuredVersion}${rest}`;
}

// Merge client query then configured query onto u; configured values win on conflict.
function mergeQuery(u: URL, clientSearch: URLSearchParams, configuredQuery?: string) {
	clientSearch.forEach((v, k) => u.searchParams.set(k, v));
	if (configuredQuery) {
		new URLSearchParams(configuredQuery).forEach((v, k) => u.searchParams.set(k, v));
	}
}


function buildUpstreamRequest(
	request: Request,
	provider: ProviderName,
	subPath: string,
	endpoint: Endpoint,
): { url: string; init: RequestInit } {
	const reqUrl = new URL(request.url);
	const base = endpoint.baseUrl.replace(/\/+$/, "");

	const headers = new Headers(request.headers);
	// Remove llmhub's own auth — will be replaced with upstream credentials
	headers.delete("Authorization");
	// Remove host so fetch uses the target host
	headers.delete("Host");

	// Transform headers for Claude CLI requests identified by anthropic-beta prefix
	const anthropicBeta = headers.get("anthropic-beta");
	if (anthropicBeta?.startsWith("fine-grained-tool-streaming")) {
		console.log('\nOpenClaw: ', anthropicBeta);
		// headers.set("anthropic-beta", "claude-code-20250219,adaptive-thinking-2026-01-28,prompt-caching-scope-2026-01-05,effort-2025-11-24");
		// headers.set("anthropic-dangerous-direct-browser-access", "true");
		// headers.set("anthropic-version", "2023-06-01");
		// headers.set("user-agent", "claude-cli/2.1.79 (external, cli)");
		// headers.set("x-app", "cli");
		// headers.set("sec-fetch-mode", "cors");
		// headers.set("x-stainless-arch", "x64");
		// headers.set("x-stainless-lang", "js");
		// headers.set("x-stainless-os", "MacOS");
		// headers.set("x-stainless-package-version", "0.74.0");
		// headers.set("x-stainless-retry-count", "0");
		// headers.set("x-stainless-runtime", "node");
		// headers.set("x-stainless-runtime-version", "v22.20.0");
		// headers.set("x-stainless-timeout", "600");
		// headers.set("host","localhost");
	}
	else
		console.log('\nClaude Code', anthropicBeta);

	const bodySize = headers.get('content-length');
	console.log(`Request body size: ${formatBytes(bodySize)} `);

	const version = endpoint.version?.trim() || DEFAULT_VERSION;
	const effectiveSubPath = applyVersionOverride(subPath, version);
	if (effectiveSubPath !== subPath) {
		console.log(`[${provider}] version override: ${subPath} → ${effectiveSubPath}`);
	}

	const upstreamUrl = new URL(`${base}${effectiveSubPath}`);
	let targetUrl: string;

	switch (provider) {
		case "anthropic":
		case "openai":
		case "grok":
			// Bearer token auth; merge client + configured query (configured wins)
			headers.set("Authorization", `Bearer ${endpoint.apiKey}`);
			mergeQuery(upstreamUrl, reqUrl.searchParams, endpoint.query);
			targetUrl = upstreamUrl.toString();
			break;

		case "gemini": {
			// Google AI: API key as query parameter, must always come from endpoint.apiKey
			reqUrl.searchParams.forEach((v, k) => {
				if (k !== "key") upstreamUrl.searchParams.set(k, v);
			});
			if (endpoint.query) {
				new URLSearchParams(endpoint.query).forEach((v, k) => {
					if (k !== "key") upstreamUrl.searchParams.set(k, v);
				});
			}
			upstreamUrl.searchParams.set("key", endpoint.apiKey);
			targetUrl = upstreamUrl.toString();
			break;
		}

		default:
			// alinls (and any future non-proxy provider) is routed elsewhere; this is unreachable.
			throw new Error(`buildUpstreamRequest called with non-proxy provider: ${provider}`);
	}

	// Debug: log x-api-key and Authorization before normalization
	const xApiKey = headers.get("x-api-key");
	const authHeader = headers.get("Authorization");
	console.log(`[${provider}] x-api-key: ${xApiKey ? maskKey(xApiKey) : "(none)"}`);
	console.log(`[${provider}] Authorization: ${authHeader ? maskKey(authHeader) : "(none)"}`);

	if (xApiKey) {
		if (authHeader) {
			headers.delete("x-api-key");
		} else {
			headers.set("Authorization", `Bearer ${xApiKey}`);
			headers.delete("x-api-key");
		}
	}

	const body =
		request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined;

	return { url: targetUrl, init: { method: request.method, headers, body } };
}

async function handleProxy(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	provider: ProviderName,
	subPath: string,
): Promise<Response> {
	const startTime = Date.now();

	// Read body first so we can log even when later steps (auth/endpoint) reject.
	let requestBody: any = undefined;
	let bodyText: string | undefined = undefined;
	if (request.body && request.method !== "GET" && request.method !== "HEAD") {
		try {
			bodyText = await request.text();
			try { requestBody = JSON.parse(bodyText); } catch { requestBody = bodyText; }
		} catch {
			// If reading fails, skip body logging
		}
	}

	const logsEnabled = await isLogsEnabled(env);
	const rawLogsFlag = await env.LLMHUB_KV.get("logs_enabled");
	console.log(`[${provider}] logsEnabled=${logsEnabled} (raw KV value=${JSON.stringify(rawLogsFlag)})`);
	const requestId = logsEnabled
		? `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
		: "";

	// Write request log up front so failed-auth / no-endpoint requests are still recorded.
	if (logsEnabled) {
		const requestLogData: RequestLogData = {
			timestamp: new Date().toISOString(),
			method: request.method,
			path: new URL(request.url).pathname,
			headers: Object.fromEntries(request.headers.entries()),
			body: requestBody,
			query: new URL(request.url).search,
			ip: request.headers.get('cf-connecting-ip') || undefined,
			userAgent: request.headers.get('user-agent') || undefined,
			requestId,
		};
		console.log(`[${provider}] scheduling request log requestId=${requestId}`);
		ctx.waitUntil(writeRequestLog(env.LLMHUB_KV, requestLogData));
	}

	const logEarlyResponse = (status: number, errorBody: any) => {
		if (!logsEnabled) return;
		ctx.waitUntil(writeResponseLog(env.LLMHUB_KV, {
			timestamp: new Date().toISOString(),
			status,
			responseTime: Date.now() - startTime,
			body: errorBody,
			requestId,
		}));
	};

	// Auth
	const authErr = await verifyToken(request, env);
	if (authErr) {
		const cloned = authErr.clone();
		let body: any;
		try { body = await cloned.json(); } catch {}
		logEarlyResponse(authErr.status, body);
		return authErr;
	}

	// Endpoint selection
	const selection = await selectEndpoint(provider, env);
	if (!selection) {
		const errBody = { error: `No available endpoint for provider: ${provider}` };
		logEarlyResponse(503, errBody);
		return jsonResponse(errBody, 503);
	}

	// Inject system records for Claude CLI requests
	const anthropicBeta = request.headers.get("anthropic-beta");
	if (anthropicBeta?.startsWith("fine-grained-tool-streaming") && requestBody && typeof requestBody === "object") {
		// console.log('handleBody..');

		// const systemPrefix = [
		// 	{ type: "text", text: "x-anthropic-billing-header: cc_version=2.1.79.04b; cc_entrypoint=cli; cch=00000;" },
		// 	{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude.", cache_control: { type: "ephemeral" } },
		// 	{ type: "text", text: "\nYou are an interactive agent that helps users with software engineering tasks. ", cache_control: { type: "ephemeral" } },
		// ];
		// const existingSystem = Array.isArray(requestBody.system) ? requestBody.system : [];
		// requestBody.system = [...systemPrefix, ...existingSystem];
		// requestBody.metadata = { user_id: "user_ba68116b494712900a4328b3bdb88d53e61182beeb3fb871336b8032c671225f_account__session_cd3ffd7d-0123-4908-b0c5-6b63e74e6bb9" };
		// requestBody.max_tokens = requestBody.max_tokens ?? 64000;
		// requestBody.thinking = requestBody.thinking ?? { type: "adaptive" };
		// requestBody.output_config = requestBody.output_config ?? { effort: "medium" };
		// requestBody.stream = true;
		// bodyText = JSON.stringify(requestBody);
	}

	// Override model if endpoint has a model specified
	const endpointModel = selection.endpoint.model?.trim();
	if (endpointModel && requestBody && typeof requestBody === "object" && "model" in requestBody) {
		requestBody.model = endpointModel;
		bodyText = JSON.stringify(requestBody);
	}

	const { enabled, strategy } = selection;
	let currentEndpoint = selection.endpoint;

	// For failover-on-error: try up to N endpoints
	const maxAttempts = strategy === "failover-on-error" ? enabled.length : 1;

	let BASE_DELAY_MS = 2000;  


	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const { url, init } = buildUpstreamRequest(request, provider, subPath, currentEndpoint);
		if (bodyText !== undefined) init.body = bodyText;

		if (attempt > 0) {
			console.log(`[${provider}] Endpoint failed, switching to key ${maskKey(currentEndpoint.apiKey)} (attempt ${attempt + 1}/${maxAttempts})`);
		} else {
			console.log(`[${provider}] Using key ${maskKey(currentEndpoint.apiKey)}`);
		}

		try {
			const upstream = await fetch(url, init);
			const responseTime = Date.now() - startTime;

			// On failover-on-error: if upstream returned 5xx/429, try next endpoint
			const shouldRetry = strategy === "failover-on-error"
				&& (upstream.status >= 400)
				// && (upstream.status >= 500 || upstream.status === 429 || upstream.status === 403)
				&& attempt < maxAttempts - 1;

			if (shouldRetry) {
				console.log(`[${provider}] Key ${maskKey(currentEndpoint.apiKey)} returned ${upstream.status}, advancing...`);
				await scheduler.wait(BASE_DELAY_MS);
				const nextIdx = advanceStickyIndex(provider, enabled.length);
				currentEndpoint = enabled[nextIdx]; 
				continue;
			}

			// Success or final attempt — log and return
			let responseBody: any = undefined;
			let clientBody: ReadableStream<Uint8Array> | null = upstream.body;
			let logBranch: ReadableStream<Uint8Array> | null = null;
			const _ctRes = upstream.headers.get('content-type') || '';
			const _isStreamRes = _ctRes.includes('event-stream');

			if (_isStreamRes && upstream.body && logsEnabled) {
				// Tee the stream so we can log without blocking the client
				const [a, b] = upstream.body.tee();
				clientBody = a;
				logBranch = b;
			} else if (!_isStreamRes) {
				const clonedResponse = upstream.clone();
				try { responseBody = await clonedResponse.json(); } catch { }
			}
			if(responseBody) console.log(responseBody);

			if (logsEnabled) {
				const responseTimestamp = new Date().toISOString();
				const responseHeaders = Object.fromEntries(upstream.headers.entries());
				const baseLog = {
					timestamp: responseTimestamp,
					status: upstream.status,
					responseTime,
					headers: responseHeaders,
					requestId,
				};
				if (logBranch) {
					ctx.waitUntil((async () => {
						const parsed = await parseSSEStreamForLog(logBranch!);
						await writeResponseLog(env.LLMHUB_KV, { ...baseLog, body: parsed });
					})());
				} else {
					ctx.waitUntil(writeResponseLog(env.LLMHUB_KV, { ...baseLog, body: responseBody }));
				}
			}


			return new Response(clientBody, {
				status: upstream.status,
				statusText: upstream.statusText,
				headers: upstream.headers,
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Unknown error";

			// On failover-on-error: network error, try next endpoint
			if (strategy === "failover-on-error" && attempt < maxAttempts - 1) {
				console.log(`[${provider}] Key ${maskKey(currentEndpoint.apiKey)} network error: ${message}, advancing...`);
				const nextIdx = advanceStickyIndex(provider, enabled.length);
				currentEndpoint = enabled[nextIdx];
				continue;
			}

			// Final attempt failed
			const responseTime = Date.now() - startTime;
			if (logsEnabled) {
				const responseLogData: ResponseLogData = {
					timestamp: new Date().toISOString(),
					status: 502,
					responseTime,
					error: message,
					requestId,
				};
				ctx.waitUntil(writeResponseLog(env.LLMHUB_KV, responseLogData));
			}

			return jsonResponse({ error: `Upstream request failed: ${message}` }, 502);
		}
	}

	// Should not reach here, but safety net
	return jsonResponse({ error: "All endpoints exhausted" }, 503);
}

// ── Router ──────────────────────────────────────────────────────────

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Admin routes
		if (path === "/" || path.startsWith("/admin")) {
			return handleAdmin(request, env, path);
		}

		// ASR routes (special: not a generic upstream proxy)
		if (path === "/asr/transcribe") {
			return handleAsrTranscribe(request, env, ctx);
		}

		// Provider proxy routes: /{provider}/...
		const match = path.match(/^\/([^/]+)(\/.*)?$/);
		if (!match) {
			return jsonResponse({ error: "Not found" }, 404);
		}

		const provider = match[1] as string;
		const subPath = match[2] || "/";

		if (!SUPPORTED_PROVIDERS.includes(provider as ProviderName)) {
			return jsonResponse({ error: `Unsupported provider: ${provider}` }, 404);
		}

		// alinls is not a generic upstream — it has dedicated /asr/* endpoints
		if (provider === "alinls") {
			return jsonResponse(
				{ error: "alinls is not exposed via generic proxy; use /asr/transcribe or /asr/stream" },
				404,
			);
		}

		return handleProxy(request, env, ctx, provider as ProviderName, subPath);
	},
} satisfies ExportedHandler<Env>;
