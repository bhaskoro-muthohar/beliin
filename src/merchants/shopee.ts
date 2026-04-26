import { Page } from 'playwright';
import { sessions } from '../lib/session.js';

export interface ShopeeCheckoutOptions {
  url: string;
  card?: { number: string; expiry: string; cvv: string; name: string };
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

export async function runShopeeCheckout(
  page: Page,
  sessionId: string,
  options: ShopeeCheckoutOptions,
): Promise<void> {
  try {
    // Step 1: Navigate product page
    sessions.update(sessionId, { state: 'navigating' });
    await page.goto(options.url, { waitUntil: 'domcontentloaded' });

    if (page.url().includes('/buyer/login')) {
      await waitForInput(sessionId, 'login_required', 'Please log in to Shopee in the browser window, then submit any value to continue');
      await page.waitForURL('!**/buyer/login**', { timeout: 120000 });
    }

    // Step 2: Handle variants
    sessions.update(sessionId, { state: 'selecting_variant' });
    const variantButtons = page.locator('.product-variation button, [data-testid="variation"] button, .flex-column .items-center button');
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
    await page.locator('button:has-text("Beli Sekarang"), button:has-text("Buy Now")').first().click();
    await page.waitForURL('**/checkout**', { timeout: 15000 });

    // Step 4: Checkout page — address/shipping auto-handled
    sessions.update(sessionId, { state: 'checkout' });
    await page.waitForLoadState('networkidle');

    // Step 5: Select payment method
    sessions.update(sessionId, { state: 'selecting_payment' });
    await page.locator('button:has-text("Kartu Kredit/Debit"), button:has-text("Credit / Debit Card")').first().click();
    await page.locator('button:has-text("Kartu Baru"), button:has-text("New Card"), button:has-text("Pay With New Card")').first().click();
    await page.waitForURL('**/payment-v2/add-card**', { timeout: 15000 });

    // Resolve card details — use provided or pause for input
    let card = options.card;
    if (!card) {
      const raw = await waitForInput(sessionId, 'card_details', 'Checkout ready. Provide card details via submit_input to continue.');
      const parsed = JSON.parse(raw);
      card = { number: parsed.card_number, expiry: parsed.card_expiry, cvv: parsed.card_cvv, name: parsed.card_name || 'CARDHOLDER' };
    }

    // Step 6: Fill card form on pay.shopee.co.id
    sessions.update(sessionId, { state: 'filling_card' });
    await page.waitForLoadState('networkidle');

    await page.fill("input[type='tel'][maxlength='19']", card.number);
    await page.fill("input[type='tel'][maxlength='5']", card.expiry);
    await page.fill("input[type='password'][maxlength='3']", card.cvv);
    await page.locator("input[type='text'].inputWithStatusInput--nCzAd").first().fill(card.name);

    await page.waitForFunction(() => {
      const btn = document.querySelector('button.submitBtn--yiKdL');
      return btn && !btn.classList.contains('submitBtnDisabled--djwns');
    }, { timeout: 10000 });
    await page.locator('button.submitBtn--yiKdL').click();
    await page.waitForURL('**/checkout**', { timeout: 15000 });

    // Step 7: Place Order
    sessions.update(sessionId, { state: 'placing_order' });
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Buat Pesanan"), button:has-text("Place Order")').first().click();

    // Step 8: CVV re-entry or 3DS or success
    sessions.update(sessionId, { state: 'cvv_entry' });
    await page.waitForURL(
      (url) => url.pathname.includes('/payment/') || url.hostname.includes('3dsecure') || url.pathname.includes('/purchase/'),
      { timeout: 30000 },
    );

    if (page.url().includes('/payment/')) {
      await page.fill("input[type='password']", card.cvv);
      await page.locator('button:has-text("Pay"), button:has-text("Bayar")').first().click();
      await page.waitForURL(
        (url) => url.hostname.includes('3dsecure') || url.hostname.includes('shopee.co.id'),
        { timeout: 30000 },
      );
    }

    // Step 9: 3DS or success
    sessions.update(sessionId, { state: 'awaiting_payment' });
    if (page.url().includes('3dsecure')) {
      const otp = await waitForInput(sessionId, 'otp', 'Enter the 3DS OTP sent to your phone');
      await page.fill('input[type="text"], input[type="password"]', otp);
      await page.locator('button:has-text("OK"), button[type="submit"]').first().click();
      await page.waitForURL('**shopee.co.id/**', { timeout: 30000 });
    }

    // Step 10: Payment result
    sessions.update(sessionId, { state: 'verifying' });
    const success = await page.locator('text=Payment Successful, text=Pembayaran Berhasil').first().isVisible({ timeout: 10000 }).catch(() => false);

    if (success) {
      sessions.update(sessionId, { state: 'success', data: { completed_at: Date.now() } });
      console.error(`[beliin] Session ${sessionId}: checkout success`);
    } else {
      sessions.update(sessionId, { state: 'failed', data: { error: 'Payment result not detected' } });
      console.error(`[beliin] Session ${sessionId}: payment result not detected`);
    }
  } catch (err) {
    sessions.update(sessionId, { state: 'failed', data: { error: (err as Error).message } });
    console.error('[beliin] Shopee checkout failed:', (err as Error).message);
  } finally {
    await page.close();
  }
}
