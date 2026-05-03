import { Page } from 'playwright';
import { mkdirSync } from 'fs';
import { sessions } from '../lib/session.js';

const DEBUG_DIR = '/tmp/beliin-debug';

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

    // Step 2: Handle variants — wait for SPA to render variant buttons
    sessions.update(sessionId, { state: 'selecting_variant' });
    await page.waitForTimeout(3000);
    console.error(`[beliin] Session ${sessionId}: on PDP — ${page.url()}`);
    await selectVariantIfNeeded(page, sessionId, options.variant);

    // Step 3: Click Buy Now (prefer direct buy; fall back to cart flow)
    sessions.update(sessionId, { state: 'adding_to_cart' });
    await page.waitForTimeout(2000);
    const buyNow = page.locator('button:has-text("Beli Langsung"), button:has-text("Beli Sekarang"), button[data-testid="pdpBuyNowButton"]');
    if (await buyNow.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await buyNow.first().click();
      console.error(`[beliin] Session ${sessionId}: clicked buy now button`);

      const navigated = await Promise.race([
        page.waitForURL('**/checkout**', { timeout: 15000 }).then(() => true),
        page.waitForTimeout(3000).then(() => false),
      ]);

      if (!navigated && !page.url().includes('/checkout')) {
        console.error(`[beliin] Session ${sessionId}: still on PDP after buy click — likely missing variant`);
        await selectVariantIfNeeded(page, sessionId, undefined, true);
        await buyNow.first().click();
        console.error(`[beliin] Session ${sessionId}: retrying buy now after variant selection`);
        await page.waitForURL('**/checkout**', { timeout: 15000 });
      }
    } else {
      console.error(`[beliin] Session ${sessionId}: buy now not visible, using cart flow`);
      const addToCart = page.locator('button:has-text("+ Keranjang"), button:has-text("Keranjang"), button[data-testid="pdpAddToCartButton"]');
      await addToCart.first().click();

      const toastVisible = await page.locator('text=/berhasil|ditambahkan|keranjang/i').first()
        .isVisible({ timeout: 5000 }).catch(() => false);

      if (!toastVisible) {
        sessions.update(sessionId, {
          state: 'failed',
          data: { error: 'Could not add item to cart — variant may not be selected or product is unavailable' },
        });
        return;
      }

      console.error(`[beliin] Session ${sessionId}: item added to cart, navigating to cart`);
      await page.goto('https://www.tokopedia.com/cart', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      await page.locator('button:has-text("Beli")').first().click();
      await page.waitForURL('**/checkout**', { timeout: 15000 });
    }
    console.error(`[beliin] Session ${sessionId}: on checkout — ${page.url()}`);

    // Step 4: Checkout page — address/shipping pre-filled
    sessions.update(sessionId, { state: 'checkout' });
    // Use bounded wait instead of networkidle (SPA keeps connections alive)
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    mkdirSync(DEBUG_DIR, { recursive: true });
    await page.screenshot({ path: `${DEBUG_DIR}/01-checkout.png`, fullPage: true });
    console.error(`[beliin] DEBUG 01-checkout: url=${page.url()}`);

    // Resolve card details — pause BEFORE touching payment if not provided
    let card = options.card;
    if (!card) {
      sessions.update(sessionId, { state: 'need_input' });
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

    // Step 5: Select payment method via payment-gateway-list iframe
    sessions.update(sessionId, { state: 'selecting_payment' });
    await page.locator('text=Lihat Semua').first().click();

    const iframeCount = await page.locator("iframe[title='payment-gateway-list']").count();
    console.error(`[beliin] DEBUG 02: url=${page.url()}, payment iframes found=${iframeCount}`);
    await page.screenshot({ path: `${DEBUG_DIR}/02-after-lihat-semua.png`, fullPage: true });

    const paymentFrame = page.frameLocator("iframe[title='payment-gateway-list']");
    await paymentFrame.locator('body').first().waitFor({ timeout: 10000 });

    // Only click "Kartu Kredit" if the section isn't already expanded
    const pakaiKartuLain = paymentFrame.locator('button:has-text("Pakai Kartu Lain")');
    const kartuKreditVisible = await paymentFrame.locator(':text-matches("Kartu Kredit", "i")').first().isVisible().catch(() => false);
    const alreadyExpanded = await pakaiKartuLain.isVisible({ timeout: 3000 }).catch(() => false);
    console.error(`[beliin] DEBUG 03: kartuKreditVisible=${kartuKreditVisible}, pakaiKartuLainVisible=${alreadyExpanded}`);

    if (!alreadyExpanded) {
      await paymentFrame.locator(':text-matches("Kartu Kredit", "i")').first().click();
      console.error(`[beliin] Session ${sessionId}: expanded Kartu Kredit section`);
      await page.waitForTimeout(2000);
    } else {
      console.error(`[beliin] Session ${sessionId}: Kartu Kredit section already expanded`);
    }
    await page.screenshot({ path: `${DEBUG_DIR}/03-after-kartu-kredit.png`, fullPage: true });

    // Minimum transaction check (D-04)
    const cardUnavailable = await paymentFrame.locator('text=Tambah kartu tidak tersedia').isVisible({ timeout: 3000 }).catch(() => false);
    if (cardUnavailable) {
      await page.screenshot({ path: `${DEBUG_DIR}/05-failure.png`, fullPage: true });
      sessions.update(sessionId, {
        state: 'failed',
        data: { error: 'Card payment unavailable — transaction below minimum (~Rp50,000). Use a higher-value product.' },
      });
      return;
    }

    // Wait for loading overlay to clear before clicking
    await paymentFrame.locator('div.css-16vaz7h, [class*="overlay"], [class*="loading"], [class*="spinner"]')
      .first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await pakaiKartuLain.scrollIntoViewIfNeeded();
    await pakaiKartuLain.click({ force: true });
    console.error(`[beliin] Session ${sessionId}: clicked Pakai Kartu Lain`);

    // Verify card iframe appeared; if not, re-expand and retry
    const cardFrame = paymentFrame.frameLocator('#iframe-creditcard');

    // Wait for card form iframe to fully load
    let iframeReady = await cardFrame.locator('div#cc-card-no').first()
      .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);

    const creditcardIframeExists = await paymentFrame.locator('#iframe-creditcard').count();
    console.error(`[beliin] DEBUG 04: iframeReady=${iframeReady}, #iframe-creditcard count=${creditcardIframeExists}`);
    await page.screenshot({ path: `${DEBUG_DIR}/04-after-pakai-kartu-lain.png`, fullPage: true });

    if (!iframeReady) {
      console.error(`[beliin] Session ${sessionId}: card iframe not found — re-expanding Kartu Kredit`);
      await paymentFrame.locator(':text-matches("Kartu Kredit", "i")').first().click();
      await page.waitForTimeout(2000);
      await pakaiKartuLain.click({ force: true });
      iframeReady = await cardFrame.locator('div#cc-card-no').first()
        .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
      if (!iframeReady) {
        await page.screenshot({ path: `${DEBUG_DIR}/05-failure.png`, fullPage: true });
        sessions.update(sessionId, {
          state: 'failed',
          data: { error: 'Card form iframe did not appear after multiple attempts.' },
        });
        return;
      }
    }

    // Step 6: Fill card form in double-nested iframe (D-01)
    // Use pressSequentially instead of fill — PCI forms need real keyboard events
    sessions.update(sessionId, { state: 'filling_card' });
    const cardNumberInput = cardFrame.locator('div#cc-card-no input[data-n-input]');
    await cardNumberInput.click();
    await cardNumberInput.pressSequentially(card.number, { delay: 80 });
    await cardNumberInput.dispatchEvent('blur');

    const cardExpiryInput = cardFrame.locator('div#cc-exp-date input[data-n-input]');
    await cardExpiryInput.click();
    await cardExpiryInput.pressSequentially(card.expiry, { delay: 80 });
    await cardExpiryInput.dispatchEvent('blur');

    await page.waitForTimeout(500);
    await cardFrame.locator("button:has-text('Konfirmasi')").click();
    console.error(`[beliin] Session ${sessionId}: clicked Konfirmasi, waiting for card processing...`);

    await paymentFrame.locator('#iframe-creditcard').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${DEBUG_DIR}/05-after-konfirmasi.png`, fullPage: true });
    console.error(`[beliin] After Konfirmasi: url=${page.url()}`);

    const hasError = await page.locator('text=/kendala|kesalahan|error|gagal/i').first().isVisible({ timeout: 2000 }).catch(() => false);
    if (hasError) {
      await page.screenshot({ path: `${DEBUG_DIR}/05-error.png`, fullPage: true });
      sessions.update(sessionId, {
        state: 'failed',
        data: { error: 'Tokopedia rejected the card after Konfirmasi. The card may be invalid or the payment gateway timed out.' },
      });
      return;
    }

    // Step 7: Handle installment modal and place order
    sessions.update(sessionId, { state: 'placing_order' });
    const bayarPenuh = paymentFrame.locator('text=Bayar Penuh');
    const hasBayarPenuh = await bayarPenuh.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasBayarPenuh) {
      await bayarPenuh.click();
    }

    await page.waitForTimeout(2000);
    await page.locator('.css-16vaz7h, [class*="overlay"], [class*="loading"]').first()
      .waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const bayarBtn = page.locator('[data-testid="btnSafChoosePayment"], button:has-text("Bayar Sekarang")').first();
    await bayarBtn.scrollIntoViewIfNeeded();
    await bayarBtn.waitFor({ state: 'visible', timeout: 10000 });

    await page.screenshot({ path: `${DEBUG_DIR}/05b-before-bayar.png`, fullPage: true });
    console.error(`[beliin] About to click Bayar Sekarang, url=${page.url()}`);

    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForTimeout(2000);
      await bayarBtn.evaluate((el: HTMLElement) => el.click());
      console.error(`[beliin] Bayar Sekarang attempt ${attempt + 1} (JS click)`);

      await page.waitForTimeout(3000);
      const hasError = await page.locator('text=/kendala|kesalahan|gagal/i').first().isVisible({ timeout: 2000 }).catch(() => false);
      if (!hasError && !page.url().includes('/checkout')) {
        console.error(`[beliin] Bayar Sekarang succeeded on attempt ${attempt + 1}`);
        break;
      }
      if (hasError && attempt < 2) {
        console.error(`[beliin] Error after Bayar Sekarang, retrying...`);
        await page.locator('button:has-text("OK"), button:has-text("Coba"), button:has-text("Tutup")').first().click().catch(() => {});
        await page.waitForTimeout(2000);
      }
    }

    await page.screenshot({ path: `${DEBUG_DIR}/05c-after-bayar.png`, fullPage: true });
    console.error(`[beliin] After Bayar Sekarang, url=${page.url()}`);

    // Step 8: CVV entry — inside iframe on pay.tokopedia.id
    sessions.update(sessionId, { state: 'cvv_entry' });

    await page.waitForURL(
      (url) => !url.href.includes('/checkout'),
      { timeout: 30000 },
    );
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${DEBUG_DIR}/06-cvv-page.png`, fullPage: true });
    console.error(`[beliin] CVV page URL: ${page.url()}`);

    const cvvFrame = page.frames().find(f => f.url().includes('pay.tokopedia.id/v2/payment/cvv'));
    if (cvvFrame) {
      const cvvInput = cvvFrame.locator('input#cvv');
      await cvvInput.waitFor({ state: 'visible', timeout: 10000 });
      await cvvInput.fill(card.cvv);

      const cvvSubmitBtn = cvvFrame.locator('button#btn-submit-cvv');
      await cvvSubmitBtn.waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${DEBUG_DIR}/07-cvv-filled.png`, fullPage: true });
      console.error(`[beliin] CVV filled, clicking Lanjutkan`);
      await cvvSubmitBtn.click();

      await page.waitForTimeout(5000);
      await page.screenshot({ path: `${DEBUG_DIR}/08-after-cvv-submit.png`, fullPage: true });
      console.error(`[beliin] After CVV submit: url=${page.url()}`);
      console.error(`[beliin] Page title: ${await page.title()}`);
      for (const frame of page.frames()) {
        console.error(`[beliin] Frame: ${frame.url()}`);
      }
    } else {
      console.error(`[beliin] No CVV iframe found — may have skipped CVV page`);
    }

    // Step 9: Poll for post-CVV outcome — success, 3DS OTP, auto-approved 3DS, error
    sessions.update(sessionId, { state: 'awaiting_payment' });

    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(5000);
      const currentUrl = page.url();
      console.error(`[beliin] Post-CVV check ${i + 1}: url=${currentUrl}`);
      await page.screenshot({ path: `${DEBUG_DIR}/08-post-cvv-${i}.png`, fullPage: true });

      const success = await page.locator('text=/pembayaran berhasil|payment successful|berhasil/i').first()
        .isVisible({ timeout: 2000 }).catch(() => false);
      if (success) {
        sessions.update(sessionId, { state: 'success', data: { completed_at: Date.now() } });
        console.error(`[beliin] Session ${sessionId}: checkout success`);
        return;
      }

      const is3DS = currentUrl.includes('3dsecure') || currentUrl.includes('acs');
      if (is3DS) {
        const otp = await waitForInput(sessionId, 'otp', 'Enter the 3DS OTP sent to your phone');
        await page.fill('input[type="text"], input[type="password"]', otp);
        await page.locator('button:has-text("OK"), button[type="submit"]').first().click();
        break;
      }

      const hasError = await page.locator('text=/gagal|ditolak|declined|error/i').first()
        .isVisible({ timeout: 2000 }).catch(() => false);
      if (hasError) {
        await page.screenshot({ path: `${DEBUG_DIR}/09-payment-error.png`, fullPage: true });
        sessions.update(sessionId, {
          state: 'failed',
          data: { error: 'Payment was declined or failed after CVV submission. URL: ' + currentUrl },
        });
        return;
      }

      if (currentUrl.includes('tokopedia.com') && !currentUrl.includes('pay.tokopedia')) {
        break;
      }
    }

    // Step 10: Verify payment result (TOKO-07)
    sessions.update(sessionId, { state: 'verifying' });
    const finalSuccess = await page.locator('text=/pembayaran berhasil|payment successful|berhasil/i').first()
      .isVisible({ timeout: 15000 }).catch(() => false);

    if (finalSuccess) {
      sessions.update(sessionId, { state: 'success', data: { completed_at: Date.now() } });
      console.error(`[beliin] Session ${sessionId}: checkout success`);
    } else {
      await page.screenshot({ path: `${DEBUG_DIR}/10-final-state.png`, fullPage: true });
      sessions.update(sessionId, { state: 'failed', data: { error: 'Payment result not detected. URL: ' + page.url() } });
      console.error(`[beliin] Session ${sessionId}: payment result not detected at ${page.url()}`);
    }
  } catch (err) {
    sessions.update(sessionId, { state: 'failed', data: { error: (err as Error).message } });
    console.error('[beliin] Tokopedia checkout failed:', (err as Error).message);
  } finally {
    await page.close();
  }
}
