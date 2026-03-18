# LLMHub

A lightweight LLM API gateway running on Cloudflare Workers. Proxy requests to multiple LLM providers through a single unified endpoint with token authentication and round-robin load balancing.

## Supported Providers

- **Anthropic** (Claude)
- **OpenAI** (GPT)
- **Google Gemini**
- **Grok** (xAI)

## Features

- **Unified Proxy** — Single access token for all providers, transparent request forwarding with streaming support
- **Multi-Endpoint** — Add multiple API keys/base URLs per provider, auto round-robin across enabled endpoints
- **Admin Dashboard** — Built-in web UI for managing providers, endpoints, and tokens (zero external dependencies)
- **Endpoint Testing** — One-click test for individual endpoints or batch test all at once
- **Quick Commands** — Copy-paste CLI commands to instantly configure Claude Code with your proxy
- **Edge Deployment** — Runs on Cloudflare Workers with KV storage, globally distributed and fast

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)

### Setup

```bash
# Clone the repo
git clone https://github.com/whcater/llmhub.git
cd llmhub

# Install dependencies
npm install

# Login to Cloudflare
wrangler login

# Create KV namespace
wrangler kv namespace create LLMHUB_KV
wrangler kv namespace create LLMHUB_KV --preview
```

Copy the namespace IDs from the output and update `wrangler.toml`:

```bash
cp wrangler-sample.toml wrangler.toml
```

Edit `wrangler.toml` with your KV namespace IDs:

```toml
name = "llmhub"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[[kv_namespaces]]
binding = "LLMHUB_KV"
id = "<YOUR_KV_NAMESPACE_ID>"
preview_id = "<YOUR_PREVIEW_KV_NAMESPACE_ID>"
```

### Set Admin Password

```bash
# Generate SHA-256 hash of your password
echo -n "your-password" | shasum -a 256 | awk '{print $1}'

# Write to KV
wrangler kv key put "admin_password_hash" "<HASH>" --namespace-id="<YOUR_KV_NAMESPACE_ID>" --remote
```

### Deploy

```bash
# Deploy to Cloudflare Workers
npm run deploy

# Or run locally for development
npm run dev
```

## Usage

### Admin Dashboard

Visit `https://<your-worker>.workers.dev/admin` to:

- Generate and manage your unified access token
- Add/edit/delete API endpoints for each provider
- Test endpoint connectivity
- Copy quick-start CLI commands

### API Proxy

All requests to `/{provider}/*` are proxied to the corresponding upstream API:

```bash
# Anthropic
curl https://<your-worker>.workers.dev/anthropic/v1/messages \
  -H "Authorization: Bearer <your-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'

# OpenAI
curl https://<your-worker>.workers.dev/openai/v1/chat/completions \
  -H "Authorization: Bearer <your-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'

# Gemini
curl https://<your-worker>.workers.dev/gemini/v1beta/models/gemini-2.0-flash:generateContent \
  -H "Authorization: Bearer <your-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'

# Grok
curl https://<your-worker>.workers.dev/grok/v1/chat/completions \
  -H "Authorization: Bearer <your-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"grok-3-mini-fast","messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'
```

### Use with Claude Code

The admin dashboard provides ready-to-copy commands. Example:

```bash
# Mac / Linux
export ANTHROPIC_AUTH_TOKEN=<your-access-token> \
  && export ANTHROPIC_BASE_URL=https://<your-worker>.workers.dev/anthropic \
  && claude
```

## Project Structure

```
src/
├── index.ts    # Entry point, router, proxy logic
├── admin.ts    # Admin API routes & endpoint testing
├── ui.ts       # Admin dashboard HTML/CSS/JS (self-contained)
└── types.ts    # Shared TypeScript types
```

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Storage**: Cloudflare Workers KV
- **Build**: Wrangler
- **Frontend**: Vanilla HTML/CSS/JS (inline, zero dependencies)

## License

MIT
