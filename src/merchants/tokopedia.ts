import { Page } from 'playwright';
import { sessions } from '../lib/session.js';

export interface TokopediaCheckoutOptions {
  url: string;
  card: { number: string; expiry: string; cvv: string };
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
    const variantButtons = page.locator('button[data-testid="pdpVariantOption"], .css-1k4y9ld button, [data-testid="lblPDPVariantName"]');
    const variantCount = await variantButtons.count();

    if (variantCount > 0) {
      if (options.variant) {
        await variantButtons.filter({ hasText: options.variant }).first().click();
      } else {
        const names: string[] = [];
        for (let i = 0; i < variantCount; i++) {
          const text = await variantButtons.nth(i).textContent();
          if (text?.trim()) names.push(text.trim());
        }
        const chosen = await waitForInput(sessionId, 'variant_selection', `Select a variant: ${names.join(', ')}`);
        await variantButtons.filter({ hasText: chosen }).first().click();
      }
    }

    // Step 3: Click Buy Now
    sessions.update(sessionId, { state: 'adding_to_cart' });
    await page.locator('button:has-text("Beli Langsung"), button:has-text("+ Keranjang")').first().click();
    await page.waitForURL('**/checkout**', { timeout: 15000 });

    // Step 4: Checkout page — address/shipping pre-filled
    sessions.update(sessionId, { state: 'checkout' });
    await page.waitForLoadState('networkidle');

    // Step 5: Select payment method via payment-gateway-list iframe
    sessions.update(sessionId, { state: 'selecting_payment' });
    await page.locator('text=Lihat Semua').first().click();

    const paymentFrame = page.frameLocator("iframe[title='payment-gateway-list']");
    await paymentFrame.locator('text=Kartu Kredit').first().click();

    // Minimum transaction check (D-04)
    const cardUnavailable = await paymentFrame.locator('text=Tambah kartu tidak tersedia').isVisible({ timeout: 3000 }).catch(() => false);
    if (cardUnavailable) {
      sessions.update(sessionId, {
        state: 'failed',
        data: { error: 'Card payment unavailable — transaction below minimum (~Rp50,000). Use a higher-value product.' },
      });
      return;
    }

    await paymentFrame.locator('button:has-text("Pakai Kartu Lain")').click();

    // Step 6: Fill card form in double-nested iframe (D-01)
    sessions.update(sessionId, { state: 'filling_card' });
    const cardFrame = paymentFrame.frameLocator('#iframe-creditcard');
    await cardFrame.locator('div#cc-card-no input[data-n-input]').fill(options.card.number);
    await cardFrame.locator('div#cc-exp-date input[data-n-input]').fill(options.card.expiry);
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
    await page.locator('input[type="password"], input[type="tel"], input[type="text"]').first().fill(options.card.cvv);
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
