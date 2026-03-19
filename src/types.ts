export interface Env {
	LLMHUB_KV: KVNamespace;
}

export interface Endpoint {
	baseUrl: string;
	apiKey: string;
	enabled: boolean;
	weight?: number; // for weighted strategy, default 1
}

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
