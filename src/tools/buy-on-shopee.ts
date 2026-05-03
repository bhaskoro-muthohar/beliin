import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sessions } from '../lib/session.js';
import { browser } from '../lib/browser.js';
import { toolResult } from '../lib/types.js';
import { runShopeeCheckout } from '../merchants/shopee.js';
import { extractCard } from './extract-card.js';

export function registerBuyOnShopeeTool(server: McpServer): void {
  server.tool(
    'buy_on_shopee',
    'Automates the full Shopee checkout in a real browser: navigates to product, selects variant, adds to cart, fills card details, handles 3DS. Runs asynchronously — poll with get_session_status. If status is need_input, call submit_input. Preferred: pass iframe_url (from view_virtual_card) so card details are scraped internally and never appear in chat.',
    {
      url: z.string().url().describe('Shopee product URL'),
      iframe_url: z.string().url().optional().describe('One-time Xfers iframe URL from view_virtual_card. Preferred over card_number/expiry/cvv — card details are scraped internally and never appear in chat.'),
      card_number: z.string().optional().describe('Card PAN (16 digits). Prefer iframe_url instead. Omit both to pause at payment.'),
      card_expiry: z.string().optional().describe('Card expiry MM/YY'),
      card_cvv: z.string().optional().describe('Card CVV (3 digits)'),
      card_name: z.string().optional().describe('Name on card'),
      variant: z.string().optional().describe('Variant to select (e.g. "Black, Size L"). Omit to be prompted if variants exist.'),
    },
    async ({ url, iframe_url, card_number, card_expiry, card_cvv, card_name, variant }) => {
      try {
        const session = sessions.create('navigating');
        const page = await browser.newPage();

        let card = card_number && card_expiry && card_cvv && card_name
          ? { number: card_number, expiry: card_expiry, cvv: card_cvv, name: card_name }
          : undefined;

        if (!card && iframe_url) {
          console.error('[beliin] Scraping card details from iframe URL');
          const scraped = await extractCard(iframe_url);
          card = { number: scraped.number, expiry: scraped.expiry, cvv: scraped.cvv, name: scraped.name };
        }

        runShopeeCheckout(page, session.id, {
          url,
          card,
          variant,
        }).catch((err) => {
          sessions.update(session.id, {
            state: 'failed',
            data: { error: (err as Error).message },
          });
          console.error('[beliin] Shopee checkout failed:', (err as Error).message);
        });

        return toolResult({
          summary: `Checkout started. Session: ${session.id}. Use get_session_status to track progress.`,
          status: 'success',
          data: { session_id: session.id, state: 'navigating' },
        });
      } catch (error) {
        return toolResult({
          summary: `Failed to start checkout: ${(error as Error).message}`,
          status: 'error',
          data: null,
        }, true);
      }
    }
  );
}
