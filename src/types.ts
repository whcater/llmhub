export interface Env {
	LLMHUB_KV: KVNamespace;
}

export interface Endpoint {
	baseUrl: string;
	version?: string; // API version segment, defaults to "v1"; rewrites client's version when mismatched
	query?: string; // fixed query string appended to upstream URL, e.g. "beta=true&trace=1"
	apiKey: string;
	enabled: boolean;
	weight?: number; // for weighted strategy, default 1
	model?: string; // optional model name, if set will override request body model
	note?: string; // optional note to distinguish similar configs

	// ── alinls-only optional fields ───────────────────────────────
	// For provider="alinls": `apiKey` holds aliAccessKeySecret.
	// All four below are alinls-specific; ignored by other providers.
	aliAccessKeyId?: string;       // 阿里云 AccessKey ID (paired with apiKey as SK)
	nlsAppKey?: string;            // NLS AppKey for the chosen language
	lyBlueBearerToken?: string;    // optional: when present, AK/SK fetched dynamically from ly-blue
	lyBlueOaid?: string;           // device oaid for ly-blue header
}

export const DEFAULT_VERSION = "v1";

export type SelectionStrategy = "failover-on-error" | "round-robin" | "random" | "failover" | "weighted";

export const STRATEGY_LABELS: Record<SelectionStrategy, string> = {
	"failover-on-error": "Failover on Error",
	"round-robin": "Round Robin",
	"random": "Random",
	"failover": "Failover (Priority)",
	"weighted": "Weighted Random",
};

export const DEFAULT_STRATEGY: SelectionStrategy = "failover-on-error";

export interface ProviderConfig {
	endpoints: Endpoint[];
	strategy?: SelectionStrategy;
}

export type ProviderName = "anthropic" | "openai" | "gemini" | "grok" | "alinls";

export const SUPPORTED_PROVIDERS: ProviderName[] = ["anthropic", "openai", "gemini", "grok", "alinls"];
