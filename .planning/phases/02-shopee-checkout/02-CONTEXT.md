# Phase 2: Shopee Checkout - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Full Shopee purchase flow: product page navigation → variant selection → cart → checkout → card entry on pay.shopee.co.id → 3DS handling → order confirmation. Delivers `buy_on_shopee`, `submit_input`, and `search_on_shopee` tools. Does NOT include Tokopedia checkout logic.

</domain>

<decisions>
## Implementation Decisions

### Checkout Flow Structure
- **D-01:** Single `buy_on_shopee` tool with session resume — one tool call initiates the full PDP → cart → payment → card fill → 3DS → done flow. Returns intermediate status via session pause/resume when human input is needed. Claude calls `submit_input` to continue.
- **D-02:** Fire-and-forget + poll for timeout handling — the tool starts the checkout flow asynchronously. If it takes >60s (MCP timeout), the browser keeps going. Claude uses `get_session_status` to poll for completion. The session tracks current stage internally.

### Session Pause/Resume
- **D-03:** Pause only for blockers — only pause when the flow genuinely can't continue without human input: 3DS OTP, captcha, login wall. Address confirmation, shipping selection, and other automatable steps are handled without pausing.
- **D-04:** Generic `submit_input` tool — one tool handles all input types. Takes `{ session_id, value }` where value is the OTP code, captcha text, etc. The session knows what it's waiting for via `input_type` field. Returns `{ status: "need_input", session_id, input_type, prompt }` per HITL-03.

### Product Page Handling
- **D-05:** URL + search support — `buy_on_shopee` accepts a direct product URL. Additionally, a `search_on_shopee` tool supports search query mode: searches Shopee, returns product URLs/titles/prices, then Claude picks one to buy.
- **D-06:** Pause for variant selection — if the product has variants (color, size) and none is specified in the tool input, the tool pauses and returns available variants via session resume. Claude relays options to user, then calls `submit_input` with the chosen variant.

### Billing Address
- **D-07:** Keep Shopee's pre-fill — Shopee pre-fills billing address from the shipping address. Don't touch the address/postal fields. x402 card may have a non-Indonesian address but Shopee likely doesn't validate billing against the card issuer.

### Claude's Discretion
- Internal state machine stages and transitions within the checkout flow
- Exact Playwright selectors beyond the documented type+maxLength patterns
- Error message wording and retry logic for flaky page loads
- How search results are parsed and ranked from Shopee search page

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Recon Data
- `~/personal/cards-hackathon-init/recon/shopee-new-card/new-card-form-selectors.json` — Complete card form field selectors, architecture (page redirect, not iframe), button selectors, PCI compliance notes
- `~/personal/cards-hackathon-init/recon/shopee-new-card/form-selectors.json` — Raw form field data including page text, input attributes, button states
- `~/personal/cards-hackathon-init/recon/shopee/` — Shopee checkout flow screenshots and data

### Project Context
- `.planning/PROJECT.md` — Core value, constraints, x402 card orchestration model
- `.planning/REQUIREMENTS.md` — Phase 2 requirements: SHOP-01 through SHOP-07, HITL-01, HITL-03
- `.planning/ROADMAP.md` — Phase 2 success criteria
- `~/personal/cards-hackathon-init/CLAUDE.md` — Hackathon context, 3DS status (auto-approve fixed), Shopee recon summary

### Phase 1 Outputs
- `.planning/phases/01-foundation-card-extraction/01-CONTEXT.md` — D-01 through D-06 decisions (project structure, browser lifecycle, tool response format)
- `src/lib/types.ts` — CardDetails, ToolResponse, Session interfaces, toolResult helper
- `src/lib/browser.ts` — BrowserManager singleton API (browser.newPage())
- `src/lib/session.ts` — SessionManager API (sessions.create/get/update/delete)
- `src/index.ts` — Tool registration pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/browser.ts` — BrowserManager singleton, use `browser.newPage()` for Shopee navigation
- `src/lib/session.ts` — SessionManager for checkout session state tracking
- `src/lib/types.ts` — `toolResult()` helper, `CardDetails` interface for card data, `Session` interface
- `src/tools/get-status.ts` — Pattern for tool registration with Zod validation and error boundary

### Established Patterns
- Tool registration: `export function registerXTool(server: McpServer)` called from `index.ts`
- Error handling: try/catch returning `toolResult({...}, true)`  never throw
- Logging: `console.error()` only — never `console.log()`
- Response format: `{ summary, status, data }` via `toolResult()` helper

### Integration Points
- `src/index.ts` — Register new tools (buy_on_shopee, submit_input, search_on_shopee)
- `src/merchants/` — Empty directory ready for Shopee adapter module
- `src/lib/session.ts` — Session.state and Session.data fields track checkout progress

</code_context>

<specifics>
## Specific Ideas

- Shopee card form is a page redirect to pay.shopee.co.id (NOT iframe) — standard `page.fill()` works
- Card field selectors: `input[type='tel'][maxlength='19']` (number), `input[type='tel'][maxlength='5']` (expiry), `input[type='password'][maxlength='3']` (CVV)
- Name on Card and Billing Address fields exist (unlike Tokopedia) — name from CardDetails, address pre-filled
- Submit button disabled until all fields filled — need to wait for enabled state
- 3DS auto-approve is fixed (William, Apr 19) — but build assuming 3DS may still trigger for robustness
- Edwin confirmed Playwright locator().fill() works on Shopee checkout

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-shopee-checkout*
*Context gathered: 2026-04-19*
