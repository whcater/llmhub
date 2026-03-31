import type { Env, Endpoint, ProviderConfig, ProviderName, SelectionStrategy } from "./types";
import { SUPPORTED_PROVIDERS, DEFAULT_STRATEGY } from "./types";
import { handleAdmin } from "./admin";
import {
	writeRequestLog,
	writeResponseLog,
	type RequestLogData,
	type ResponseLogData
} from "./logger";


const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

// ── Auth middleware ──────────────────────────────────────────────────

async function verifyToken(request: Request, env: Env): Promise<Response | null> {
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

interface EndpointSelection {
	endpoint: Endpoint;
	enabled: Endpoint[];
	strategy: SelectionStrategy;
}

async function selectEndpoint(provider: ProviderName, env: Env): Promise<EndpointSelection | null> {
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
	// const units = ['B', 'KB', 'MB', 'GB'];
	// const i = Math.floor(Math.log(bytes) / Math.log(1024));
	// return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
// ── Proxy ────────────────────────────────────────────────────────────

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

	let targetUrl: string;

	switch (provider) {
		case "anthropic":
			// Anthropic uses Bearer token auth
			headers.set("Authorization", `Bearer ${endpoint.apiKey}`);
			targetUrl = `${base}${subPath}${reqUrl.search}`;
			break;

		case "openai":
		case "grok":
			// OpenAI-compatible: Bearer token
			headers.set("Authorization", `Bearer ${endpoint.apiKey}`);
			targetUrl = `${base}${subPath}${reqUrl.search}`;
			break;

		case "gemini": {
			// Google AI: API key as query parameter
			const u = new URL(`${base}${subPath}`);
			u.searchParams.set("key", endpoint.apiKey);
			// Preserve original query params
			reqUrl.searchParams.forEach((v, k) => {
				if (k !== "key") u.searchParams.set(k, v);
			});
			targetUrl = u.toString();
			break;
		}
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
	provider: ProviderName,
	subPath: string,
): Promise<Response> {
	const startTime = Date.now();

	// Auth
	const authErr = await verifyToken(request, env);
	if (authErr) return authErr;

	// Endpoint selection
	const selection = await selectEndpoint(provider, env);
	if (!selection) {
		return jsonResponse({ error: `No available endpoint for provider: ${provider}` }, 503);
	}

	// Read request body once for reuse (logging + possible retries)
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

	// Log request
	const requestLogData: RequestLogData = {
		timestamp: new Date().toISOString(),
		method: request.method,
		path: new URL(request.url).pathname,
		headers: Object.fromEntries(request.headers.entries()),
		body: requestBody,
		query: new URL(request.url).search,
		ip: request.headers.get('cf-connecting-ip') || undefined,
		userAgent: request.headers.get('user-agent') || undefined,
	};
	const requestId = await writeRequestLog(env.LLMHUB_KV, requestLogData);

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
			const clonedResponse = upstream.clone();
			try { responseBody = await clonedResponse.json(); } catch { }
			if(responseBody) console.log(responseBody);

			const responseLogData: ResponseLogData = {
				timestamp: new Date().toISOString(),
				status: upstream.status,
				responseTime,
				body: responseBody,
				headers: Object.fromEntries(upstream.headers.entries()),
				requestId,
			};
			await writeResponseLog(env.LLMHUB_KV, responseLogData);

			return new Response(upstream.body, {
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
			const responseLogData: ResponseLogData = {
				timestamp: new Date().toISOString(),
				status: 502,
				responseTime,
				error: message,
				requestId,
			};
			await writeResponseLog(env.LLMHUB_KV, responseLogData);

			return jsonResponse({ error: `Upstream request failed: ${message}` }, 502);
		}
	}

	// Should not reach here, but safety net
	return jsonResponse({ error: "All endpoints exhausted" }, 503);
}

// ── Router ──────────────────────────────────────────────────────────

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Admin routes
		if (path === "/" || path.startsWith("/admin")) {
			return handleAdmin(request, env, path);
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

		return handleProxy(request, env, provider as ProviderName, subPath);
	},
} satisfies ExportedHandler<Env>;
