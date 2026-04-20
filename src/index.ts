import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { browser } from './lib/browser.js';
import { registerGetStatusTool } from './tools/get-status.js';
import { registerExtractCardTool } from './tools/extract-card.js';
import { registerSubmitInputTool } from './tools/submit-input.js';
import { registerBuyOnShopeeTool } from './tools/buy-on-shopee.js';
import { registerSearchOnShopeeTool } from './tools/search-on-shopee.js';
import { registerBuyOnTokopediaTool } from './tools/buy-on-tokopedia.js';

const server = new McpServer({
  name: 'beliin',
  version: '0.1.0',
});

registerGetStatusTool(server);
registerExtractCardTool(server);
registerSubmitInputTool(server);
registerBuyOnShopeeTool(server);
registerSearchOnShopeeTool(server);
registerBuyOnTokopediaTool(server);

try {
  await browser.init();
} catch (err) {
  console.error('[beliin] Failed to initialize browser:', (err as Error).message);
  process.exit(1);
}

const cleanup = async () => {
  await browser.cleanup();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[beliin] MCP server running on stdio');
