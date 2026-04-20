# Roadmap: beliin

## Overview

beliin delivers an MCP server that automates e-commerce checkout on Shopee and Tokopedia using Playwright. The build order follows increasing complexity: server infrastructure and card extraction first, then Shopee (page-redirect card entry), then Tokopedia (double-nested cross-origin iframe card entry). Each phase delivers a complete, testable capability.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation + Card Extraction** - MCP server skeleton, browser manager, session infrastructure, and Xfers card scraping (completed 2026-04-19)
- [x] **Phase 2: Shopee Checkout** - Full purchase flow on Shopee with page-redirect card entry and 3DS handling (completed 2026-04-19)
- [ ] **Phase 3: Tokopedia Checkout** - Full purchase flow on Tokopedia with double-nested iframe card entry and 3DS handling

## Phase Details

### Phase 1: Foundation + Card Extraction
**Goal**: Server infrastructure is operational and virtual card details can be extracted from an Xfers iframe URL
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, CARD-01, CARD-02, CARD-03, HITL-02, HITL-04
**Success Criteria** (what must be TRUE):
  1. Claude Desktop can connect to beliin MCP server via stdio and list available tools
  2. Browser context persists at ~/.beliin/browser-data/ across server restarts, preserving login sessions
  3. extract_card_details returns structured { number, expiry, cvv, name } from a one-time Xfers iframe URL in a single page load
  4. get_session_status returns current state for any session_id
  5. All tool errors return { isError: true } responses without crashing the server
**Plans:** 2 plans
Plans:
- [x] 01-01-PLAN.md — MCP server scaffolding, core modules (browser, session, types), get_session_status tool (completed 2026-04-19)
- [x] 01-02-PLAN.md — extract_card_details tool (Xfers iframe scraping with innerText + regex) (completed 2026-04-19)

### Phase 2: Shopee Checkout
**Goal**: Users can complete a full Shopee purchase using a virtual card, with human-in-the-loop for OTP/3DS
**Depends on**: Phase 1
**Requirements**: SHOP-01, SHOP-02, SHOP-03, SHOP-04, SHOP-05, SHOP-06, SHOP-07, HITL-01, HITL-03
**Success Criteria** (what must be TRUE):
  1. buy_on_shopee navigates a product URL, selects variant if needed, and reaches the checkout page
  2. Card details are filled on pay.shopee.co.id payment page using PCI-compliant selectors (type+maxLength)
  3. When 3DS triggers, session pauses with { status: "need_input", input_type, prompt } and submit_input resumes it
  4. Checkout completes successfully on both 3DS-triggered and 3DS-skipped paths
  5. Tool returns clear success/failure status after checkout flow ends
**Plans:** 3 plans
Plans:
- [x] 02-01-PLAN.md — Generic submit_input tool for session pause/resume (HITL infrastructure) (completed 2026-04-19)
- [x] 02-02-PLAN.md — Shopee checkout adapter + buy_on_shopee tool (full purchase flow) (completed 2026-04-19)
- [x] 02-03-PLAN.md — search_on_shopee tool (product discovery by keyword) (completed 2026-04-19)

### Phase 3: Tokopedia Checkout
**Goal**: Users can complete a full Tokopedia purchase using a virtual card, handling double-nested cross-origin iframe card entry
**Depends on**: Phase 2
**Requirements**: TOKO-01, TOKO-02, TOKO-03, TOKO-04, TOKO-05, TOKO-06, TOKO-07
**Success Criteria** (what must be TRUE):
  1. buy_on_tokopedia navigates a product URL, selects variant if needed, and reaches the checkout page
  2. Card details are filled inside double-nested cross-origin iframe chain (payment-gateway-list -> iframe-creditcard) using container ID selectors
  3. When 3DS triggers, session pauses and submit_input resumes it (reusing Phase 2 infrastructure)
  4. Checkout completes successfully on both 3DS-triggered and 3DS-skipped paths

**Plans:** 1 plan
Plans:
- [x] 03-01-PLAN.md — Tokopedia checkout adapter + buy_on_tokopedia tool (full purchase flow with double-nested iframe card entry)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation + Card Extraction | 2/2 | Complete | 2026-04-19 |
| 2. Shopee Checkout | 3/3 | Complete | 2026-04-19 |
| 3. Tokopedia Checkout | 0/1 | Planned | - |
