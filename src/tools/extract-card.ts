import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { browser } from '../lib/browser.js';
import { CardDetails, toolResult } from '../lib/types.js';

async function extractCard(url: string): Promise<CardDetails> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    const text = await page.innerText('body');

    console.error('[beliin] Card page text length:', text.length);

    const numberMatch = text.match(/\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/);
    const expiryMatch = text.match(/\b(0[1-9]|1[0-2])\s?\/\s?(\d{2})\b/);
    const cvvMatch = text.match(/(?:CVV|CVC|Security\s*Code)[:\s]*(\d{3})\b/i)
      || text.match(/\b(\d{3})\b(?![\d/])/);
    const nameMatch = text.match(/(?:Name|Cardholder)[:\s]*([A-Za-z\s]+)/i)
      || text.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/);

    if (!numberMatch || !expiryMatch || !cvvMatch) {
      console.error('[beliin] Card extraction failed. Page text:', text);
      throw new Error(
        `Could not extract card fields. Found: number=${!!numberMatch}, expiry=${!!expiryMatch}, cvv=${!!cvvMatch}`
      );
    }

    return {
      number: numberMatch[1].replace(/[\s-]/g, ''),
      expiry: `${expiryMatch[1]}/${expiryMatch[2]}`,
      cvv: cvvMatch[1],
      name: nameMatch ? nameMatch[1].trim() : 'CARDHOLDER',
    };
  } finally {
    await page.close();
  }
}

export function registerExtractCardTool(server: McpServer): void {
  server.tool(
    'extract_card_details',
    'Extract virtual card details (PAN, expiry, CVV, name) from a one-time Xfers iframe URL. URL expires after single use.',
    { url: z.string().url().describe('One-time Xfers iframe URL from view_virtual_card') },
    async ({ url }) => {
      try {
        const card = await extractCard(url);
        return toolResult({
          summary: `Card extracted: ****${card.number.slice(-4)}, exp ${card.expiry}`,
          status: 'success',
          data: card,
        });
      } catch (error) {
        return toolResult({
          summary: `Card extraction failed: ${(error as Error).message}`,
          status: 'error',
          data: null,
        }, true);
      }
    }
  );
}
