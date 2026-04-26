import { Page } from 'playwright';
import { sessions } from '../lib/session.js';

export interface TokopediaCheckoutOptions {
  url: string;
  card?: { number: string; expiry: string; cvv: string };
  variant?: string;
}

function waitForInput(sessionId: string, inputType: string, prompt: string): Promise<string> {
  return new Promise<string>((resolve) => {
    sessions.update(sessionId, {
      state: 'need_input',
      data: { input_type: inputType, prompt, resolve },
    });
    console.error(`[beliin] Session ${sessionId} paused: ${inputType}`);
  });
}

async function scrapeVariantOptions(page: Page): Promise<string[]> {
  const selectors = [
    'button[data-testid="pdpVariantOption"]',
    '.css-1k4y9ld button',
    '[data-testid="lblPDPVariantName"]',
    '[data-testid="pdpVariantTitle"] ~ div button',
    '.variant-option button',
    '[class*="variant"] button',
  ];
  const combined = page.locator(selectors.join(', '));
  const count = await combined.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await combined.nth(i).textContent();
    if (text?.trim()) names.push(text.trim());
  }
  return names;
}

async function selectVariantIfNeeded(
  page: Page,
  sessionId: string,
  preferredVariant?: string,
  forceAsk = false,
): Promise<void> {
  const options = await scrapeVariantOptions(page);
  if (options.length === 0) return;

  const selectors = [
    'button[data-testid="pdpVariantOption"]',
    '.css-1k4y9ld button',
    '[data-testid="lblPDPVariantName"]',
    '[data-testid="pdpVariantTitle"] ~ div button',
    '.variant-option button',
    '[class*="variant"] button',
  ];
  const buttons = page.locator(selectors.join(', '));

  if (preferredVariant && !forceAsk) {
    await buttons.filter({ hasText: preferredVariant }).first().click();
    console.error(`[beliin] Session ${sessionId}: selected variant "${preferredVariant}"`);
    return;
  }

  const chosen = await waitForInput(sessionId, 'variant_selection', `Select a variant: ${options.join(', ')}`);
  await buttons.filter({ hasText: chosen }).first().click();
  console.error(`[beliin] Session ${sessionId}: selected variant "${chosen}"`);
}

export async function runTokopediaCheckout(
  page: Page,
  sessionId: string,
  options: TokopediaCheckoutOptions,
): Promise<void> {
  try {
    // Step 1: Navigate product page
    sessions.update(sessionId, { state: 'navigating' });
    await page.goto(options.url, { waitUntil: 'domcontentloaded' });

    if (page.url().includes('/login') || page.url().includes('accounts.tokopedia.com')) {
      await waitForInput(sessionId, 'login_required', 'Please log in to Tokopedia in the browser window, then submit any value to continue');
      await page.waitForURL(
        (url) => !url.pathname.includes('/login') && !url.hostname.includes('accounts.tokopedia.com'),
        { timeout: 120000 },
      );
    }

    // Step 2: Handle variants
    sessions.update(sessionId, { state: 'selecting_variant' });
    console.error(`[beliin] Session ${sessionId}: on PDP — ${page.url()}`);
    await selectVariantIfNeeded(page, sessionId, options.variant);

    // Step 3: Click Buy Now (prefer direct buy; fall back to cart flow)
    sessions.update(sessionId, { state: 'adding_to_cart' });
    const buyNow = page.locator('button:has-text("Beli Langsung")');
    if (await buyNow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await buyNow.click();
      console.error(`[beliin] Session ${sessionId}: clicked Beli Langsung`);

      const navigated = await Promise.race([
        page.waitForURL('**/checkout**', { timeout: 15000 }).then(() => true),
        page.waitForTimeout(3000).then(() => false),
      ]);

      if (!navigated && !page.url().includes('/checkout')) {
        console.error(`[beliin] Session ${sessionId}: still on PDP after buy click — likely missing variant`);
        await selectVariantIfNeeded(page, sessionId, undefined, true);
        await buyNow.click();
        console.error(`[beliin] Session ${sessionId}: retrying Beli Langsung after variant selection`);
        await page.waitForURL('**/checkout**', { timeout: 15000 });
      }
    } else {
      console.error(`[beliin] Session ${sessionId}: Beli Langsung not visible, using cart flow`);
      await page.locator('button:has-text("+ Keranjang")').first().click();
      await page.goto('https://www.tokopedia.com/cart', { waitUntil: 'domcontentloaded' });
      await page.locator('button:has-text("Beli")').first().click();
      await page.waitForURL('**/checkout**', { timeout: 15000 });
    }
    console.error(`[beliin] Session ${sessionId}: on checkout — ${page.url()}`);

    // Step 4: Checkout page — address/shipping pre-filled
    sessions.update(sessionId, { state: 'checkout' });
    // Use bounded wait instead of networkidle (SPA keeps connections alive)
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Step 5: Select payment method via payment-gateway-list iframe
    sessions.update(sessionId, { state: 'selecting_payment' });
    await page.locator('text=Lihat Semua').first().click();

    const paymentFrame = page.frameLocator("iframe[title='payment-gateway-list']");
    await paymentFrame.locator('body').first().waitFor({ timeout: 10000 });
    await paymentFrame.locator(':text-matches("Kartu Kredit", "i")').first().click();
    console.error(`[beliin] Session ${sessionId}: selected Kartu Kredit payment method`);

    await page.waitForTimeout(2000);

    // Minimum transaction check (D-04)
    const cardUnavailable = await paymentFrame.locator('text=Tambah kartu tidak tersedia').isVisible({ timeout: 3000 }).catch(() => false);
    if (cardUnavailable) {
      sessions.update(sessionId, {
        state: 'failed',
        data: { error: 'Card payment unavailable — transaction below minimum (~Rp50,000). Use a higher-value product.' },
      });
      return;
    }

    // Wait for loading overlay to clear before clicking
    await paymentFrame.locator('div.css-16vaz7h, [class*="overlay"], [class*="loading"], [class*="spinner"]')
      .first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await paymentFrame.locator('button:has-text("Pakai Kartu Lain")').click({ force: true });
    console.error(`[beliin] Session ${sessionId}: clicked Pakai Kartu Lain`);

    // Resolve card details — use provided or pause for input
    let card = options.card;
    if (!card) {
      const raw = await waitForInput(sessionId, 'card_details', 'Checkout ready. Provide card details via submit_input to continue.');

      if (!page.url().includes('/checkout')) {
        sessions.update(sessionId, {
          state: 'failed',
          data: { error: 'Checkout page expired while waiting for card details. Retry with card details provided upfront to avoid the wait.' },
        });
        return;
      }

      const parsed = JSON.parse(raw);
      card = { number: parsed.card_number, expiry: parsed.card_expiry, cvv: parsed.card_cvv };
    }

    // Step 6: Fill card form in double-nested iframe (D-01)
    sessions.update(sessionId, { state: 'filling_card' });
    const cardFrame = paymentFrame.frameLocator('#iframe-creditcard');
    await cardFrame.locator('div#cc-card-no input[data-n-input]').fill(card.number);
    await cardFrame.locator('div#cc-exp-date input[data-n-input]').fill(card.expiry);
    await cardFrame.locator("button:has-text('Konfirmasi')").click();

    // Step 7: Handle installment modal and place order
    sessions.update(sessionId, { state: 'placing_order' });
    const bayarPenuh = paymentFrame.locator('text=Bayar Penuh');
    const hasBayarPenuh = await bayarPenuh.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasBayarPenuh) {
      await bayarPenuh.click();
    }

    await page.locator('[data-testid="btnSafChoosePayment"], button:has-text("Bayar Sekarang")').first().click();

    // Step 8: CVV entry on separate page (D-02)
    sessions.update(sessionId, { state: 'cvv_entry' });
    await page.waitForURL('**/payment/validate/**', { timeout: 15000 });
    await page.locator('input[type="password"], input[type="tel"], input[type="text"]').first().fill(card.cvv);
    await page.locator('button:has-text("Lanjutkan"), button:has-text("Pay")').first().click();

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

    // Step 10: Verify payment result (TOKO-07)
    sessions.update(sessionId, { state: 'verifying' });
    const success = await page.locator('text=pembayaran berhasil').first().isVisible({ timeout: 15000 }).catch(() => false);

    if (success) {
      sessions.update(sessionId, { state: 'success', data: { completed_at: Date.now() } });
      console.error(`[beliin] Session ${sessionId}: checkout success`);
    } else {
      sessions.update(sessionId, { state: 'failed', data: { error: 'Payment result not detected' } });
      console.error(`[beliin] Session ${sessionId}: payment result not detected`);
    }
  } catch (err) {
    sessions.update(sessionId, { state: 'failed', data: { error: (err as Error).message } });
    console.error('[beliin] Tokopedia checkout failed:', (err as Error).message);
  } finally {
    await page.close();
  }
}
