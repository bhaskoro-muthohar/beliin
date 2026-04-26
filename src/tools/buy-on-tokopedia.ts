import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sessions } from '../lib/session.js';
import { browser } from '../lib/browser.js';
import { toolResult } from '../lib/types.js';
import { runTokopediaCheckout } from '../merchants/tokopedia.js';

export function registerBuyOnTokopediaTool(server: McpServer): void {
  server.tool(
    'buy_on_tokopedia',
    'Automates the full Tokopedia checkout in a real browser: navigates to product, selects variant, adds to cart, fills card details in nested iframe, handles 3DS. Runs asynchronously — poll with get_session_status. If status is need_input, call submit_input. This is the ONLY way to buy on Tokopedia.',
    {
      url: z.string().url().describe('Tokopedia product URL'),
      card_number: z.string().optional().describe('Card PAN (16 digits). Omit to pause at payment — provide later via submit_input with card_details.'),
      card_expiry: z.string().optional().describe('Card expiry MM/YY'),
      card_cvv: z.string().optional().describe('Card CVV (3 digits)'),
      variant: z.string().optional().describe('Variant to select (e.g. "1m, Black"). Omit to be prompted if variants exist.'),
    },
    async ({ url, card_number, card_expiry, card_cvv, variant }) => {
      try {
        const session = sessions.create('navigating');
        const page = await browser.newPage();

        const card = card_number && card_expiry && card_cvv
          ? { number: card_number, expiry: card_expiry, cvv: card_cvv }
          : undefined;

        runTokopediaCheckout(page, session.id, {
          url,
          card,
          variant,
        }).catch((err) => {
          sessions.update(session.id, {
            state: 'failed',
            data: { error: (err as Error).message },
          });
          console.error('[beliin] Tokopedia checkout failed:', (err as Error).message);
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
