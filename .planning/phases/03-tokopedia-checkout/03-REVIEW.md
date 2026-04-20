---
phase: 03-tokopedia-checkout
reviewed: 2026-04-20T08:30:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/merchants/tokopedia.ts
  - src/tools/buy-on-tokopedia.ts
  - src/index.ts
findings:
  critical: 1
  warning: 3
  info: 0
  total: 4
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-04-20T08:30:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

The Tokopedia checkout adapter implements a solid async session-based flow with proper error handling and human-in-the-loop patterns. However, there is a critical race condition in 3DS detection that will cause it to never trigger, and a few reliability issues around navigation assumptions.

## Critical Issues

### CR-01: 3DS Detection Race Condition — URL Checked Before Navigation

**File:** `src/merchants/tokopedia.ts:110`
**Issue:** After clicking the "Pay" button on line 106, the code immediately checks `page.url()` on line 110 for 3DS indicators (`3dsecure`, `acs`). Playwright's `click()` does not wait for navigation to complete. At this point the URL is still the `/payment/validate/` page, so the 3DS condition will never be true — the entire 3DS handling block is dead code.
**Fix:**
```typescript
// Step 9: 3DS handling (TOKO-05/06)
sessions.update(sessionId, { state: 'awaiting_payment' });

// Wait for navigation after clicking pay — either 3DS redirect or success page
await page.waitForURL(
  (url) => url.href.includes('3dsecure') || url.href.includes('acs') || url.href.includes('tokopedia.com/payment') || url.href.includes('pembayaran'),
  { timeout: 30000 },
);

const is3DS = page.url().includes('3dsecure') || page.url().includes('acs');
if (is3DS) {
  const otp = await waitForInput(sessionId, 'otp', 'Enter the 3DS OTP sent to your phone');
  await page.fill('input[type="text"], input[type="password"]', otp);
  await page.locator('button:has-text("OK"), button[type="submit"]').first().click();
  await page.waitForURL('**tokopedia.com/**', { timeout: 30000 });
}
```

## Warnings

### WR-01: "Add to Cart" Fallback Breaks Checkout Flow

**File:** `src/merchants/tokopedia.ts:59`
**Issue:** The locator targets both "Beli Langsung" (Buy Now) and "+ Keranjang" (Add to Cart). If "Beli Langsung" is unavailable (some products only show Add to Cart), clicking "+ Keranjang" adds to cart but does NOT navigate to checkout. The subsequent `waitForURL('**/checkout**')` on line 60 will timeout with an unhelpful error.
**Fix:**
```typescript
// Prefer Buy Now; fall back to cart flow with explicit navigation
const buyNow = page.locator('button:has-text("Beli Langsung")');
if (await buyNow.isVisible({ timeout: 3000 }).catch(() => false)) {
  await buyNow.click();
  await page.waitForURL('**/checkout**', { timeout: 15000 });
} else {
  await page.locator('button:has-text("+ Keranjang")').first().click();
  // Navigate to cart then checkout
  await page.goto('https://www.tokopedia.com/cart', { waitUntil: 'domcontentloaded' });
  await page.locator('button:has-text("Beli")').first().click();
  await page.waitForURL('**/checkout**', { timeout: 15000 });
}
```

### WR-02: No Error Handling for Browser Initialization

**File:** `src/index.ts:23`
**Issue:** `await browser.init()` at the top level has no try/catch. If Chromium fails to launch (missing binary, display server issues, corrupted profile), the process crashes with an unhandled error and no useful diagnostic for the MCP client.
**Fix:**
```typescript
try {
  await browser.init();
} catch (err) {
  console.error('[beliin] Failed to initialize browser:', (err as Error).message);
  process.exit(1);
}
```

### WR-03: `networkidle` Wait Can Hang on SPA

**File:** `src/merchants/tokopedia.ts:64`
**Issue:** `waitForLoadState('networkidle')` waits until no network requests for 500ms. Tokopedia's SPA maintains persistent WebSocket connections and analytics pings, which can prevent `networkidle` from ever resolving — causing the checkout to hang indefinitely with no timeout.
**Fix:**
```typescript
// Use a bounded wait instead of networkidle
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2000); // Allow dynamic content to render
```

---

_Reviewed: 2026-04-20T08:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
