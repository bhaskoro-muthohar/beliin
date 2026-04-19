import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sessions } from '../lib/session.js';
import { toolResult } from '../lib/types.js';

export function registerGetStatusTool(server: McpServer): void {
  server.tool(
    'get_session_status',
    'Get the current state of a checkout session',
    { session_id: z.string().describe('The session ID to check') },
    async ({ session_id }) => {
      try {
        const session = sessions.get(session_id);
        if (!session) {
          return toolResult({
            summary: `Session ${session_id} not found`,
            status: 'not_found',
            data: null,
          }, true);
        }
        return toolResult({
          summary: `Session ${session_id}: ${session.state}`,
          status: 'success',
          data: { id: session.id, state: session.state, createdAt: session.createdAt, data: session.data },
        });
      } catch (error) {
        return toolResult({
          summary: `Failed to get session status: ${(error as Error).message}`,
          status: 'error',
          data: null,
        }, true);
      }
    }
  );
}
