import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { browser } from '../lib/browser.js';
import { toolResult } from '../lib/types.js';

export function registerSearchOnShopeeTool(server: McpServer): void {
  server.tool(
    'search_on_shopee',
    'Search Shopee Indonesia for products using a real browser. Returns top 10 results with name, price, and URL. Use the returned URL with buy_on_shopee to purchase. This is the ONLY way to search Shopee — do not attempt to browse shopee.co.id yourself.',
    {
      query: z.string().describe('Search query (e.g. "mechanical keyboard", "mouse pad")'),
    },
    async ({ query }) => {
      const page = await browser.newPage();
      try {
        const searchUrl = `https://shopee.co.id/search?keyword=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'networkidle' });

        const products = await page.locator('a[href*="-i."]').evaluateAll((links) =>
          links.slice(0, 10).map((link) => {
            const href = link.getAttribute('href') || '';
            const name = link.textContent?.trim().substring(0, 100) || '';
            return {
              name,
              url: href.startsWith('http') ? href : `https://shopee.co.id${href}`,
            };
          })
        );

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
