# Phase 3: Tokopedia Checkout - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Full Tokopedia purchase flow: product page navigation → variant selection → cart → checkout → double-nested iframe card entry → CVV separate page → 3DS handling → order confirmation. Delivers `buy_on_tokopedia` tool. Reuses `submit_input` and `get_session_status` from Phase 2. Does NOT include any Shopee logic changes.

</domain>

<decisions>
## Implementation Decisions

### Iframe Navigation
- **D-01:** frameLocator chaining — use `page.frameLocator("iframe[title='payment-gateway-list']").frameLocator("#iframe-creditcard")` to reach the cross-origin card form. Auto-waits, handles cross-origin transparently. No fallback to `frame().find()`.

### CVV Page Flow
- **D-02:** Auto-fill CVV — after Place Order, Tokopedia redirects to `pay.tokopedia.com/v3/payment/validate/CREDITCARD` for CVV entry. Fill it automatically using the card CVV already provided in the tool input. No pause needed for CVV.

### Tool Structure
- **D-03:** Mirror Shopee structure — `buy_on_tokopedia` follows the same pattern as `buy_on_shopee`: single tool, fire-and-forget + poll, same session states, same variant pause logic. Reuses `submit_input` for 3DS OTP. Consistent API for Claude.

### Minimum Transaction
- **D-04:** Fail gracefully with message — if card payment option is disabled (below ~Rp50k), detect the disabled state and return an error with a clear message explaining the minimum. Don't attempt card entry.

### Claude's Discretion
- Exact Playwright selectors for Tokopedia PDP variant buttons and Buy Now button
- How to detect the "Pakai Kartu Lain" button is disabled (minimum transaction check)
- Error message wording for minimum transaction and other failures
- Whether to check the "Simpan kartu" checkbox (save card for future transactions)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Recon Data
- `~/personal/cards-hackathon-init/recon/tokopedia-new-card/new-card-form-selectors.json` — Complete card form architecture (double-nested iframe), field selectors (container IDs), trigger button, CVV separate page, minimum transaction
- `~/personal/cards-hackathon-init/recon/tokopedia/` — Tokopedia checkout flow screenshots and data

### Project Context
- `.planning/PROJECT.md` — Core value, constraints, x402 card orchestration model
- `.planning/REQUIREMENTS.md` — Phase 3 requirements: TOKO-01 through TOKO-07
- `.planning/ROADMAP.md` — Phase 3 success criteria
- `~/personal/cards-hackathon-init/CLAUDE.md` — Hackathon context, 3DS status (auto-approve fixed), Tokopedia recon summary

### Phase 1 & 2 Outputs
- `.planning/phases/01-foundation-card-extraction/01-CONTEXT.md` — D-01 through D-06 (project structure, browser lifecycle, tool response format)
- `.planning/phases/02-shopee-checkout/02-CONTEXT.md` — D-01 through D-07 (checkout flow structure, session pause/resume, fire-and-forget pattern)
- `src/merchants/shopee.ts` — Reference implementation for merchant adapter pattern (runShopeeCheckout, waitForInput, session state updates)
- `src/tools/buy-on-shopee.ts` — Reference implementation for fire-and-forget tool pattern
- `src/lib/types.ts` — CardDetails, ToolResponse, Session interfaces, toolResult helper
- `src/lib/browser.ts` — BrowserManager singleton API
- `src/lib/session.ts` — SessionManager API
- `src/tools/submit-input.ts` — Generic HITL resume tool (reused for Tokopedia 3DS)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/merchants/shopee.ts` — `waitForInput()` helper and `runShopeeCheckout()` pattern to mirror for Tokopedia
- `src/tools/buy-on-shopee.ts` — Fire-and-forget tool pattern to replicate
- `src/tools/submit-input.ts` — Reuse directly for 3DS OTP (no changes needed)
- `src/lib/session.ts` — Same session state machine for checkout progress
- `src/lib/types.ts` — Same `toolResult()` helper and `CardDetails` interface

### Established Patterns
- Tool registration: `export function registerXTool(server: McpServer)` called from `index.ts`
- Merchant adapter: `export async function runXCheckout(page, sessionId, options)` with try/catch/finally
- Session states: `navigating → selecting_variant → adding_to_cart → checkout → selecting_payment → filling_card → placing_order → cvv_entry → awaiting_payment → verifying → success/failed`
- Fire-and-forget: `runXCheckout(page, session.id, options).catch(...)` without await

### Integration Points
- `src/index.ts` — Register `buy_on_tokopedia` tool
- `src/merchants/` — Add `tokopedia.ts` adapter module

</code_context>

<specifics>
## Specific Ideas

- Tokopedia card form is inside double-nested iframes — `frameLocator` chaining is the key difference from Shopee
- Card fields use container ID selectors: `div#cc-card-no input[data-n-input]`, `div#cc-exp-date input[data-n-input]`
- No CVV in add-card form — separate page at `pay.tokopedia.com/v3/payment/validate/CREDITCARD`
- No Name on Card or Billing Address fields (simpler than Shopee)
- "Pakai Kartu Lain" button triggers the new card form — inside the payment-gateway-list iframe
- Minimum ~Rp50k for card option to appear — detect disabled state
- Submit button text is "Konfirmasi" (not "Submit" like Shopee)
- 3DS auto-approve is fixed (William, Apr 19) — but build assuming 3DS may still trigger

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-tokopedia-checkout*
*Context gathered: 2026-04-19*
