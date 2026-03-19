import type { Env, Endpoint, ProviderConfig, ProviderName } from "./types";
import { SUPPORTED_PROVIDERS } from "./types";
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
	if (!authorization?.startsWith("Bearer ")) {
		return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
	}

	if (authorization.slice(7) !== authToken) {
		return jsonResponse({ error: "Invalid token" }, 403);
	}

	return null; // passed
}

// ── Endpoint selection (round-robin via timestamp) ───────────────────

async function selectEndpoint(provider: ProviderName, env: Env): Promise<Endpoint | null> {
	const raw = await env.LLMHUB_KV.get(`provider:${provider}`);
	if (!raw) return null;

	const config: ProviderConfig = JSON.parse(raw);
	const enabled = config.endpoints.filter((e) => e.enabled);
	if (enabled.length === 0) return null;

	// Simple round-robin: use current timestamp so distribution is roughly even
	// without requiring a KV write per request.
	return enabled[Date.now() % enabled.length];
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

	// Endpoint
	const endpoint = await selectEndpoint(provider, env);
	if (!endpoint) {
		return jsonResponse({ error: `No available endpoint for provider: ${provider}` }, 503);
	}

	// Clone request body for logging BEFORE building upstream request
	let requestBody: any = undefined;
	let bodyForUpstream: BodyInit | undefined = undefined;
	
	if (request.body && request.method !== "GET" && request.method !== "HEAD") {
		try {
			// Read the body once and store it
			const bodyText = await request.text();
			
			// Try to parse as JSON for logging
			try {
				requestBody = JSON.parse(bodyText);
			} catch {
				requestBody = bodyText; // Store as text if not JSON
			}
			
			// Create new body for upstream request
			bodyForUpstream = bodyText;
		} catch {
			// If reading fails, skip body logging
		}
	}

	// Build upstream request with the stored body
	const { url, init } = buildUpstreamRequest(request, provider, subPath, endpoint);
	
	// Override the body with our stored version
	if (bodyForUpstream !== undefined) {
		init.body = bodyForUpstream;
	}

	// Log request (timestamp will be converted to Shanghai time in logger)
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

	try {
		const upstream = await fetch(url, init);
		const responseTime = Date.now() - startTime;

		// Clone response for logging
		let responseBody: any = undefined;
		const clonedResponse = upstream.clone();
		try {
			responseBody = await clonedResponse.json();
		} catch {
			// If not JSON, skip body logging
		}

		// Log response (timestamp will be converted to Shanghai time in logger)
		const responseLogData: ResponseLogData = {
			timestamp: new Date().toISOString(),
			status: upstream.status,
			responseTime,
			body: responseBody,
			headers: Object.fromEntries(upstream.headers.entries()),
			requestId,
		};

		await writeResponseLog(env.LLMHUB_KV, responseLogData);
 
		// Stream the response back as-is
		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: upstream.headers,
		});
	} catch (err: unknown) {
		const responseTime = Date.now() - startTime;
		const message = err instanceof Error ? err.message : "Unknown error";

		// Log error response (timestamp will be converted to Shanghai time in logger)
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
