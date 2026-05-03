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
    await page.waitForTimeout(1000);

    await page.screenshot({ path: `${DEBUG_DIR}/05b-before-bayar.png`, fullPage: true });
    console.error(`[beliin] About to click Bayar Sekarang, url=${page.url()}`);
    await bayarBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${DEBUG_DIR}/05c-after-bayar.png`, fullPage: true });
    console.error(`[beliin] After Bayar Sekarang, url=${page.url()}`);

    // Step 8: Wait for any navigation away from checkout — CVV page, 3DS, or success
    sessions.update(sessionId, { state: 'cvv_entry' });
    await page.waitForURL(
      (url) => {
        const href = url.href;
        return href.includes('payment/validate') ||
               href.includes('3dsecure') ||
               href.includes('acs') ||
               href.includes('verify') ||
               href.includes('otp') ||
               href.includes('pembayaran') ||
               !href.includes('/checkout');
      },
      { timeout: 30000 },
    );
    console.error(`[beliin] Post-payment URL: ${page.url()}`);
    await page.screenshot({ path: `${DEBUG_DIR}/07-post-payment.png`, fullPage: true });

    const postPayUrl = page.url();

    // Branch based on where we landed
    if (postPayUrl.includes('payment/validate') || postPayUrl.includes('verify')) {
      // CVV entry page
      await page.waitForTimeout(2000);

      await page.screenshot({ path: `${DEBUG_DIR}/08-cvv-page.png`, fullPage: true });
      const inputCount = await page.locator('input').count();
      const iframeCount2 = await page.locator('iframe').count();
      console.error(`[beliin] CVV page inputs: ${inputCount}, iframes: ${iframeCount2}`);

      const cvvSelectors = [
        'input[name="cvv"]',
        'input[placeholder*="CVV" i]',
        'input[placeholder*="CVC" i]',
        'input[autocomplete="cc-csc"]',
        'input[type="password"]',
        'input[type="tel"]',
        'input[type="text"]',
      ];

      let cvvFilled = false;

      for (const sel of cvvSelectors) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
          await loc.click();
          await loc.pressSequentially(card.cvv, { delay: 50 });
          cvvFilled = true;
          console.error(`[beliin] CVV filled via: ${sel}`);
          break;
        }
      }

      if (!cvvFilled && iframeCount2 > 0) {
        const frames = page.frames();
        for (const frame of frames) {
          if (frame === page.mainFrame()) continue;
          for (const sel of cvvSelectors) {
            const loc = frame.locator(sel).first();
            if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
              await loc.fill(card.cvv);
              cvvFilled = true;
              console.error(`[beliin] CVV filled via iframe: ${sel}`);
              break;
            }
          }
          if (cvvFilled) break;
        }
      }

      if (!cvvFilled) {
        await page.screenshot({ path: `${DEBUG_DIR}/08-cvv-failed.png`, fullPage: true });
        sessions.update(sessionId, {
          state: 'failed',
          data: { error: `CVV input not found. Inputs: ${inputCount}, iframes: ${iframeCount2}` },
        });
        return;
      }

      await page.screenshot({ path: `${DEBUG_DIR}/09-cvv-filled.png`, fullPage: true });

      await page.waitForTimeout(1000);
      const submitBtn = page.locator('button:has-text("Lanjutkan"), button:has-text("Pay"), button:has-text("Bayar"), button:has-text("Konfirmasi"), button[type="submit"]').first();
      await submitBtn.scrollIntoViewIfNeeded();
      await submitBtn.waitFor({ state: 'visible', timeout: 10000 });

      await page.waitForTimeout(1000);
      const isEnabled = await submitBtn.isEnabled();
      console.error(`[beliin] Lanjutkan button visible, enabled=${isEnabled}`);
      await page.screenshot({ path: `${DEBUG_DIR}/10-before-lanjutkan.png`, fullPage: true });

      if (!isEnabled) {
        console.error(`[beliin] Button disabled — retrying CVV fill`);
      }

      await submitBtn.click();
      console.error(`[beliin] Clicked Lanjutkan/submit on CVV page`);

      // Wait for next navigation after CVV submit
      await page.waitForURL(
        (url) => {
          const href = url.href;
          return href.includes('3dsecure') || href.includes('acs') ||
                 href.includes('tokopedia.com/payment') || href.includes('pembayaran') ||
                 (!href.includes('payment/validate') && !href.includes('verify'));
        },
        { timeout: 30000 },
      );
    }

    // Step 9: 3DS handling (TOKO-05/06)
    sessions.update(sessionId, { state: 'awaiting_payment' });
    console.error(`[beliin] Pre-3DS check URL: ${page.url()}`);

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
