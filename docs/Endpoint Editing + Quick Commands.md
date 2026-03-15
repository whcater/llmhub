# Plan: Endpoint Editing + Quick Commands

## Context
LLMHub admin UI currently allows adding/deleting endpoints but not editing them. Users also need copyable CLI commands to quickly configure Claude to use the proxy. Both features only require changes to `src/ui.ts`.

## File to modify
- `/Users/ylp/dev/lab/llmhub/src/ui.ts` — the only file; no backend changes needed

---

## Feature 1: Inline Edit for Endpoints

### Changes in `renderEndpoints()` (line 352-383)

1. **Add Edit button** to the `.actions` div in each endpoint row (between Test and Delete)
2. **Add edit-btn click handler** that:
   - Replaces the masked URL/Key spans with pre-filled `<input>` fields
   - Replaces Edit/Delete buttons with Save/Cancel buttons
   - Save: updates `providerData[name][i]` and calls `saveProvider(name)`
   - Cancel: calls `renderEndpoints()` to revert

### CSS additions
- Style inline edit inputs (`.edit-url`, `.edit-key`) to match existing layout

---

## Feature 2: Quick Run Commands

### Commands per provider (N providers = N*2 commands)

**Mac & Linux:**
```
export ANTHROPIC_AUTH_TOKEN=<token> && export ANTHROPIC_BASE_URL=<origin>/<provider> && claude --dangerously-skip-permissions
```

**Windows:**
```
set ANTHROPIC_AUTH_TOKEN=<token> & set ANTHROPIC_BASE_URL=<origin>/<provider> & claude --dangerously-skip-permissions
```

- `<token>` = Access Token from top of page
- `<origin>/<provider>` = e.g. `https://llmhub.example.com/anthropic`

> Note: User's original message had platform labels swapped; implementing with correct commands per platform.

### Changes

1. **Add CSS** for `.cmd-group`, `.cmd-block`, `.cmd-label`, `.cmd-text`, `.cmd-copy`
2. **Add HTML section** `<div id="quickCmds">` after the providers div
3. **Add `renderQuickCommands()` function** that builds commands for all 4 providers with Copy buttons
4. **Call `renderQuickCommands()`** in:
   - `init()` after `loadProviders()`
   - `genBtn` click handler after token update

---

## Verification
1. `npm run deploy` or `wrangler dev` to test locally
2. Verify Edit button appears on existing endpoints → click → inputs appear → Save/Cancel work
3. Verify Quick Commands section shows 4 providers × 2 platforms = 8 commands
4. Verify Copy buttons work and "Copied!" feedback shows
5. Generate new token → verify commands update immediately
