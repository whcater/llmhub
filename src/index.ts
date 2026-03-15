import type { Env, Endpoint, ProviderConfig, ProviderName } from "./types";
import { SUPPORTED_PROVIDERS } from "./types";
import { handleAdmin } from "./admin";

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
	// Auth
	const authErr = await verifyToken(request, env);
	if (authErr) return authErr;

	// Endpoint
	const endpoint = await selectEndpoint(provider, env);
	if (!endpoint) {
		return jsonResponse({ error: `No available endpoint for provider: ${provider}` }, 503);
	}

	const { url, init } = buildUpstreamRequest(request, provider, subPath, endpoint);

	try {
		const upstream = await fetch(url, init);
 
		// Stream the response back as-is
		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: upstream.headers,
		});
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Unknown error";
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
