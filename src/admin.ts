import type { Env, ProviderConfig, ProviderName } from "./types";
import { loginPage, adminPage } from "./ui";

const SUPPORTED_PROVIDERS: ProviderName[] = ["anthropic", "openai", "gemini", "grok"];

const SESSION_TTL = 60 * 60 * 24; // 24 hours

const json = (body: unknown, status = 200, extra?: HeadersInit) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...extra },
	});

// ── Helpers ──────────────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
	const data = new TextEncoder().encode(text);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
	const buf = new Uint8Array(32);
	crypto.getRandomValues(buf);
	return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getCookie(request: Request, name: string): string | null {
	const cookie = request.headers.get("Cookie");
	if (!cookie) return null;
	const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
	return match ? match[1] : null;
}

async function verifySession(request: Request, env: Env): Promise<boolean> {
	const token = getCookie(request, "session");
	if (!token) return false;
	const stored = await env.LLMHUB_KV.get(`session:${token}`);
	return stored === "valid";
}

function sessionCookie(token: string): string {
	return `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL}`;
}

// ── Route handlers ───────────────────────────────────────────────────

async function login(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

	const body = await request.json<{ password?: string }>();
	if (!body.password) return json({ error: "Password required" }, 400);

	const storedHash = await env.LLMHUB_KV.get("admin_password_hash");
	if (!storedHash) return json({ error: "Admin password not configured" }, 503);

	const inputHash = await sha256(body.password);
	if (inputHash !== storedHash) return json({ error: "Invalid password" }, 401);

	const token = randomToken();
	await env.LLMHUB_KV.put(`session:${token}`, "valid", { expirationTtl: SESSION_TTL });

	return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
}

async function session(request: Request, env: Env): Promise<Response> {
	if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
	const valid = await verifySession(request, env);
	return json({ authenticated: valid }, valid ? 200 : 401);
}

async function token(request: Request, env: Env): Promise<Response> {
	if (request.method === "GET") {
		const current = await env.LLMHUB_KV.get("auth_token");
		return json({ token: current ?? null });
	}

	if (request.method === "POST") {
		const newToken = randomToken();
		await env.LLMHUB_KV.put("auth_token", newToken);
		return json({ token: newToken });
	}

	return json({ error: "Method not allowed" }, 405);
}

async function listProviders(request: Request, env: Env): Promise<Response> {
	if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

	const providers: Record<string, ProviderConfig | null> = {};
	for (const name of SUPPORTED_PROVIDERS) {
		const raw = await env.LLMHUB_KV.get(`provider:${name}`);
		providers[name] = raw ? JSON.parse(raw) : null;
	}
	return json({ providers });
}

async function updateProvider(
	request: Request,
	env: Env,
	name: string,
): Promise<Response> {
	if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

	if (!SUPPORTED_PROVIDERS.includes(name as ProviderName)) {
		return json({ error: `Unsupported provider: ${name}` }, 400);
	}

	const body = await request.json<ProviderConfig>();
	if (!Array.isArray(body.endpoints)) {
		return json({ error: "Invalid payload: endpoints array required" }, 400);
	}

	await env.LLMHUB_KV.put(`provider:${name}`, JSON.stringify(body));
	return json({ ok: true, provider: name });
}

interface TestResult {
	success: boolean;
	duration: number;
	error?: string;
	status?: number;
}

function extractBodyError(body: unknown): string | null {
	if (!body || typeof body !== "object") return null;
	const b = body as Record<string, unknown>;
	if (b.error) {
		if (typeof b.error === "string") return b.error;
		if (typeof b.error === "object" && b.error !== null) {
			const e = b.error as Record<string, unknown>;
			if (typeof e.message === "string") return e.message;
		}
		return JSON.stringify(b.error);
	}
	if (b.success === false && typeof b.message === "string") return b.message;
	return null;
}

async function checkJsonBodyError(resp: Response, duration: number): Promise<TestResult> {
	const text = await resp.text().catch(() => "");
	try {
		const body = JSON.parse(text);
		const errMsg = extractBodyError(body);
		if (errMsg) return { success: false, duration, status: 200, error: errMsg };
	} catch {}
	return { success: true, duration, status: 200 };
}

async function runTest(provider: string, baseUrl: string, apiKey: string): Promise<TestResult> {
	const start = Date.now();
	try {
		let resp: Response;
		const base = baseUrl.replace(/\/+$/, "");

		switch (provider) {
			case "anthropic": {
				resp = await fetch(`${base}/v1/messages?beta=true`, {
					method: "POST",
					headers: {
						"accept": "application/json",
						"accept-encoding": "gzip, deflate",
						"accept-language": "*",
						"anthropic-beta": "claude-code-20250219,adaptive-thinking-2026-01-28,prompt-caching-scope-2026-01-05,effort-2025-11-24",
						"anthropic-dangerous-direct-browser-access": "true",
						"anthropic-version": "2023-06-01",
						"authorization": `Bearer ${apiKey}`,
						"content-type": "application/json",
						"sec-fetch-mode": "cors",
						"user-agent": "claude-cli/2.1.71 (external, cli)",
						"x-app": "cli",
						"x-stainless-arch": "x64",
						"x-stainless-lang": "js",
						"x-stainless-os": "MacOS",
						"x-stainless-package-version": "0.74.0",
						"x-stainless-retry-count": "0",
						"x-stainless-runtime": "node",
						"x-stainless-runtime-version": "v22.20.0",
						"x-stainless-timeout": "600",
					},
					body: JSON.stringify({
						model: "claude-opus-4-6",
						messages: [{ role: "user", content: [{ type: "text", text: "say hi", cache_control: { type: "ephemeral" } }] }],
						system: [
							{ type: "text", text: "x-anthropic-billing-header: cc_version=2.1.71.752; cc_entrypoint=cli; cch=00000;" },
							{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude.", cache_control: { type: "ephemeral" } },
							{ type: "text", text: "\nYou are an interactive agent that helps users with software engineering tasks. ", cache_control: { type: "ephemeral" } },
						],
						metadata: { user_id: "user_ba68116b494712900a4328b3bdb88d53e61182beeb3fb871336b8032c671225f_account__session_cd3ffd7d-0123-4908-b0c5-6b63e74e6bb9" },
						max_tokens: 32000,
						thinking: { type: "adaptive" },
						output_config: { effort: "medium" },
						stream: true,
					}),
				});
				const duration = Date.now() - start;
				if (resp.status !== 200) {
					const text = await resp.text().catch(() => "");
					return { success: false, duration, status: resp.status, error: text || `HTTP ${resp.status}` };
				}
				// For streaming, check for error events in the SSE response
				const chunk = await resp.text().catch(() => "");
				const errEventMatch = chunk.match(/event:\s*error\ndata:\s*(\{.*\})/);
				if (errEventMatch) {
					try {
						const errData = JSON.parse(errEventMatch[1]);
						return { success: false, duration, status: 200, error: errData.error?.message || "Stream error" };
					} catch {}
					return { success: false, duration, status: 200, error: "Stream error" };
				}
				return { success: chunk.length > 0, duration, status: 200 };
			}

			case "openai": {
				resp = await fetch(`${base}/v1/chat/completions`, {
					method: "POST",
					headers: {
						"Authorization": `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: "gpt-4o-mini",
						messages: [{ role: "user", content: "hi" }],
						max_tokens: 5,
					}),
				});
				const duration = Date.now() - start;
				if (resp.status !== 200) {
					const text = await resp.text().catch(() => "");
					return { success: false, duration, status: resp.status, error: text || `HTTP ${resp.status}` };
				}
				return checkJsonBodyError(resp, duration);
			}

			case "grok": {
				resp = await fetch(`${base}/v1/chat/completions`, {
					method: "POST",
					headers: {
						"Authorization": `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: "grok-3-mini-fast",
						messages: [{ role: "user", content: "hi" }],
						max_tokens: 5,
					}),
				});
				const duration = Date.now() - start;
				if (resp.status !== 200) {
					const text = await resp.text().catch(() => "");
					return { success: false, duration, status: resp.status, error: text || `HTTP ${resp.status}` };
				}
				return checkJsonBodyError(resp, duration);
			}

			case "gemini": {
				resp = await fetch(`${base}/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						contents: [{ parts: [{ text: "hi" }] }],
					}),
				});
				const duration = Date.now() - start;
				if (resp.status !== 200) {
					const text = await resp.text().catch(() => "");
					return { success: false, duration, status: resp.status, error: text || `HTTP ${resp.status}` };
				}
				return checkJsonBodyError(resp, duration);
			}

			default:
				return { success: false, duration: Date.now() - start, error: `Unsupported provider: ${provider}` };
		}
	} catch (err) {
		return {
			success: false,
			duration: Date.now() - start,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

async function testEndpoint(request: Request, _env: Env): Promise<Response> {
	if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

	const body = await request.json<{ provider?: string; baseUrl?: string; apiKey?: string }>();
	if (!body.provider || !body.baseUrl || !body.apiKey) {
		return json({ error: "provider, baseUrl, and apiKey are required" }, 400);
	}

	const result = await runTest(body.provider, body.baseUrl, body.apiKey);
	return json(result);
}

async function testBatch(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

	const body = await request.json<{ provider?: string }>();
	if (!body.provider) {
		return json({ error: "provider is required" }, 400);
	}

	const raw = await env.LLMHUB_KV.get(`provider:${body.provider}`);
	if (!raw) {
		return json({ error: `No config found for provider: ${body.provider}` }, 404);
	}

	const config: ProviderConfig = JSON.parse(raw);
	const enabledEndpoints = config.endpoints.filter((ep) => ep.enabled);
	if (enabledEndpoints.length === 0) {
		return json({ results: [], message: "No enabled endpoints" });
	}

	const results = await Promise.all(
		enabledEndpoints.map(async (ep) => {
			const result = await runTest(body.provider!, ep.baseUrl, ep.apiKey);
			return { baseUrl: ep.baseUrl, ...result };
		}),
	);

	return json({ results });
}

async function changePassword(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

	const body = await request.json<{ current?: string; newPassword?: string }>();
	if (!body.current || !body.newPassword) {
		return json({ error: "current and newPassword are required" }, 400);
	}

	const storedHash = await env.LLMHUB_KV.get("admin_password_hash");
	if (storedHash) {
		const currentHash = await sha256(body.current);
		if (currentHash !== storedHash) return json({ error: "Current password is incorrect" }, 401);
	}

	const newHash = await sha256(body.newPassword);
	await env.LLMHUB_KV.put("admin_password_hash", newHash);
	return json({ ok: true });
}

// ── Log viewing ──────────────────────────────────────────────────────

async function listLogFolders(request: Request, env: Env): Promise<Response> {
	if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

	const list = await env.LLMHUB_KV.list({ prefix: "logs/" });
	const folders = new Set<string>();
	
	for (const key of list.keys) {
		const match = key.name.match(/^logs\/([^/]+)\//);
		if (match) folders.add(match[1]);
	}

	return json({ folders: Array.from(folders).sort().reverse() });
}

async function listLogFiles(request: Request, env: Env, folder: string): Promise<Response> {
	if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

	const prefix = `logs/${folder}/`;
	const list = await env.LLMHUB_KV.list({ prefix });
	
	const files = list.keys.map(k => ({
		name: k.name.replace(prefix, ""),
		key: k.name,
	})).sort((a, b) => b.name.localeCompare(a.name));

	return json({ folder, files });
}

async function getLogContent(request: Request, env: Env): Promise<Response> {
	if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

	const url = new URL(request.url);
	const key = url.searchParams.get("key");
	if (!key || !key.startsWith("logs/")) {
		return json({ error: "Invalid log key" }, 400);
	}

	const content = await env.LLMHUB_KV.get(key);
	if (!content) return json({ error: "Log not found" }, 404);

	try {
		const parsed = JSON.parse(content);
		return json({ key, content: parsed, raw: content });
	} catch {
		return json({ key, content: null, raw: content });
	}
}

// ── Router ───────────────────────────────────────────────────────────

export async function handleAdmin(request: Request, env: Env, path: string): Promise<Response> {
	// Public route — no session required
	if (path === "/admin/api/login") return login(request, env);

	// All other /admin/api/* routes require a valid session
	if (path.startsWith("/admin/api/")) {
		if (!(await verifySession(request, env))) {
			return json({ error: "Unauthorized" }, 401);
		}

		if (path === "/admin/api/session") return session(request, env);
		if (path === "/admin/api/token") return token(request, env);
		if (path === "/admin/api/providers") return listProviders(request, env);
		if (path === "/admin/api/test") return testEndpoint(request, env);
		if (path === "/admin/api/test-batch") return testBatch(request, env);
		if (path === "/admin/api/change-password") return changePassword(request, env);
		if (path === "/admin/api/logs") return listLogFolders(request, env);
		if (path === "/admin/api/log-content") return getLogContent(request, env);

		// Match /admin/api/providers/:name
		const providerMatch = path.match(/^\/admin\/api\/providers\/([^/]+)$/);
		if (providerMatch) return updateProvider(request, env, providerMatch[1]);

		// Match /admin/api/logs/:folder
		const logFolderMatch = path.match(/^\/admin\/api\/logs\/([^/]+)$/);
		if (logFolderMatch) return listLogFiles(request, env, logFolderMatch[1]);

		return json({ error: "Not found" }, 404);
	}

	// HTML pages
	const html = (body: string) =>
		new Response(body, { headers: { "Content-Type": "text/html;charset=UTF-8" } });

	if (path === "/admin/login") return html(loginPage());

	// All other /admin paths serve the dashboard (session checked client-side)
	return html(adminPage());
}
