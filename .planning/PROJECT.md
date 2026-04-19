# beliin

## What This Is

An MCP server (TypeScript, Node, stdio transport) that automates e-commerce checkout on Tokopedia and Shopee using Playwright. Claude Desktop orchestrates two MCP servers — x402card (card issuance) and beliin (checkout). beliin scrapes virtual card details from an Xfers-hosted iframe and drives the merchant checkout flow end-to-end.

## Core Value

Given a product URL and virtual card details, complete the checkout autonomously — pausing only when human input is genuinely required (OTP, CVV, captcha).

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] MCP server runs over stdio transport, compatible with Claude Desktop
- [ ] extract_card_details tool scrapes PAN, expiry, CVV, name from one-time Xfers iframe URL
- [ ] buy_on_shopee tool drives full checkout: PDP → cart → payment → card entry → 3DS → success
- [ ] buy_on_tokopedia tool drives full checkout with double-iframe card entry handling
- [ ] submit_input tool resumes paused sessions for OTP, CVV, captcha input
- [ ] get_session_status tool returns current checkout state
- [ ] Session state persists across tool calls via in-memory Map
- [ ] Persistent Playwright browser context at ~/.beliin/browser-data/ preserves login sessions
- [ ] Human-in-the-loop via session-based resume pattern (no readline/CLI prompts)
- [ ] Handles both 3DS-triggered and 3DS-skipped checkout paths

### Out of Scope

- Card issuance API calls — Claude orchestrates x402card separately
- Eval harness — get happy path working first
- Other merchants beyond Shopee and Tokopedia
- CLI/terminal UI — this is MCP-only
- Payment safety guards (don't click Pay during dev unless intentional)

## Context

- Part of a hackathon project with x402card (virtual card issuance MCP)
- Edwin (another participant) confirmed Playwright can scrape the Xfers iframe and fill Shopee checkout
- Recon data available at ~/personal/cards-hackathon-init/recon/shopee/, recon/shopee-new-card/, recon/tokopedia/, recon/tokopedia-new-card/
- William built OOB auto-approve for 3DS but it's currently broken (ticket AHD-3018) — build assuming 3DS may trigger
- Shopee card entry is a separate page redirect (pay.shopee.co.id), not an iframe
- Tokopedia card entry uses double-nested iframes: payment-gateway-list → iframe-creditcard (cross-origin pay.tokopedia.id)
- Shopee card form fields use class-based selectors (inputWithStatusInput--nCzAd), no name/id attrs (PCI DSS)
- Tokopedia card form uses container IDs (#cc-card-no, #cc-exp-date) but no name/id on inputs
- Tokopedia requires minimum ~Rp89k transaction for card option to appear
- Xfers iframe URL is one-time use and expires — extract once, hold in memory

## Constraints

- **Transport**: stdio only — Claude Desktop MCP protocol
- **Runtime**: Node.js + TypeScript
- **Browser**: Playwright chromium with persistent context
- **No CLI prompts**: Human-in-the-loop via session resume pattern only
- **Dependencies**: @modelcontextprotocol/sdk, playwright, zod
- **PCI DSS selectors**: Card form fields lack standard name/id attributes on both merchants

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| stdio transport (not SSE/HTTP) | Claude Desktop MCP standard | — Pending |
| Persistent browser context | Preserves merchant login sessions/cookies | — Pending |
| Session-based resume for human input | No terminal in Claude Desktop, MCP tools must be stateless per-call | — Pending |
| Build order: extract → Shopee → Tokopedia | Increasing complexity; Shopee has no iframe nesting | — Pending |
| In-memory Map for session state | Simplest approach, server lifetime matches usage | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-19 after initialization*
