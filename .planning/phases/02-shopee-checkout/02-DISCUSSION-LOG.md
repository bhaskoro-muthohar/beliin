# Phase 2: Shopee Checkout - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 02-shopee-checkout
**Areas discussed:** Checkout flow structure, Session pause/resume, Product page handling, Billing address + x402 card

---

## Checkout Flow Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Single monolithic tool | One buy_on_shopee call does everything PDP → done. Simpler but may hit 60s timeout. | |
| Multi-step tools | Separate tools per stage. Claude orchestrates the sequence. | |
| Single tool + session resume | One tool runs full flow, returns intermediate status via pause/resume. | ✓ |

**User's choice:** Single tool + session resume
**Notes:** None

---

| Option | Description | Selected |
|--------|-------------|----------|
| Fire-and-forget + poll | Start async, browser keeps going past timeout. Claude polls via get_session_status. | ✓ |
| Stage-based resume | Break flow into stages, each within timeout. | |
| Optimistic (assume <60s) | Let it run, handle timeout as error. | |

**User's choice:** Fire-and-forget + poll
**Notes:** None

---

## Session Pause/Resume

| Option | Description | Selected |
|--------|-------------|----------|
| Pause only for blockers | Only pause for 3DS OTP, captcha, login wall. Everything else automated. | ✓ |
| Pause at checkpoints | Also pause at address, shipping, total confirmation. | |
| Fully autonomous | Never pause, only return errors. | |

**User's choice:** Pause only for blockers
**Notes:** None

---

| Option | Description | Selected |
|--------|-------------|----------|
| Generic submit_input | One tool, takes { session_id, value }. Session knows what it's waiting for. | ✓ |
| Typed input tools | Separate submit_otp, submit_captcha, etc. | |

**User's choice:** Generic submit_input
**Notes:** None

---

## Product Page Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Direct product URL | Claude passes full Shopee product URL. Tool navigates directly. | |
| URL + search support | Also supports search query mode via search_on_shopee tool. | ✓ |

**User's choice:** URL + search support
**Notes:** None

---

| Option | Description | Selected |
|--------|-------------|----------|
| Claude specifies variant | Claude passes desired variant in tool input. | |
| Auto-select first variant | Tool picks first available variant. | |
| Pause for variant selection | If variants exist and none specified, pause and return options. | ✓ |

**User's choice:** Pause for variant selection
**Notes:** None

---

## Billing Address + x402 Card

| Option | Description | Selected |
|--------|-------------|----------|
| Keep Shopee's pre-fill | Leave billing address as-is from shipping. Don't touch fields. | ✓ |
| Claude provides address | Claude passes billing address as tool input. | |
| Pre-fill with fallback | Try pre-fill, retry with different address on failure. | |

**User's choice:** Keep Shopee's pre-fill
**Notes:** None

---

## Claude's Discretion

- Internal state machine stages and transitions
- Exact Playwright selectors beyond documented patterns
- Error message wording and retry logic
- Search result parsing and ranking

## Deferred Ideas

None
