import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { browser } from '../lib/browser.js';
import { toolResult } from '../lib/types.js';

export function registerSearchOnTokopediaTool(server: McpServer): void {
  server.tool(
    'search_on_tokopedia',
    'Search Tokopedia Indonesia for products using a real browser. Returns top 10 results with name, price, rating, sold count, store, and URL. Use the returned URL with buy_on_tokopedia to purchase. This is the ONLY way to search Tokopedia — do not attempt to browse tokopedia.com yourself.',
    {
      query: z.string().describe('Search query (e.g. "mechanical keyboard", "mouse pad")'),
    },
    async ({ query }) => {
      const page = await browser.newPage();
      try {
        const searchUrl = `https://www.tokopedia.com/search?q=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const products = await page.evaluate(() => {
          const cards = Array.from(
            document.querySelectorAll('a:has(img[alt="product-image"])')
          ).slice(0, 10);

          return cards.map((card) => {
            const link = card as HTMLAnchorElement;
            const url = link.href.split('?')[0];

            const divs = Array.from(
              link.querySelectorAll(':scope > div > div:nth-child(2) > div')
            );

            const name = divs[0]?.textContent?.trim() || '';

            let price = '';
            const priceEl = divs[1];
            if (priceEl) {
              const firstPrice = priceEl.querySelector('div');
              price = firstPrice?.textContent?.trim() || priceEl.textContent?.trim() || '';
            }

            let rating = '';
            let sold = '';
            for (const div of divs) {
              const ratingImg = div.querySelector('img[alt="rating"]');
              if (ratingImg) {
                const ratingText = ratingImg.nextElementSibling;
                rating = ratingText?.textContent?.trim().replace(/"/g, '') || '';
                const soldEl = div.querySelector('div:last-child');
                if (soldEl && soldEl !== ratingText?.parentElement) {
                  sold = soldEl.textContent?.trim() || '';
                }
                break;
              }
            }

            let store = '';
            for (const div of divs) {
              const badge = div.querySelector('img[alt="shop badge"]');
              if (badge) {
                const storeInfo = badge.closest('div')?.querySelectorAll('div > div');
                if (storeInfo && storeInfo.length >= 1) {
                  store = storeInfo[0]?.textContent?.trim() || '';
                }
                break;
              }
            }

            return { name, price, rating, sold, store, url };
          });
        });

        if (products.length === 0) {
          return toolResult({
            summary: `No products found for "${query}"`,
            status: 'success',
            data: { query, products: [] },
          });
        }

        return toolResult({
          summary: `Found ${products.length} products for "${query}"`,
          status: 'success',
          data: { query, products },
        });
      } catch (error) {
        return toolResult({
          summary: `Search failed: ${(error as Error).message}`,
          status: 'error',
          data: null,
        }, true);
      } finally {
        await page.close();
      }
    }
  );
}
