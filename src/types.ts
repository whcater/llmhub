export interface Env {
	LLMHUB_KV: KVNamespace;
}

export interface Endpoint {
	baseUrl: string;
	apiKey: string;
	enabled: boolean;
}

export interface ProviderConfig {
	endpoints: Endpoint[];
}

export type ProviderName = "anthropic" | "openai" | "gemini" | "grok";

export const SUPPORTED_PROVIDERS: ProviderName[] = ["anthropic", "openai", "gemini", "grok"];
