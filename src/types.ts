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

export type ProviderName = "anthropic" | "openai" | "gemini" | "grok";

export const SUPPORTED_PROVIDERS: ProviderName[] = ["anthropic", "openai", "gemini", "grok"];
