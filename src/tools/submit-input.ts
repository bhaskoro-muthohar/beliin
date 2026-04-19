import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sessions } from '../lib/session.js';
import { toolResult } from '../lib/types.js';

export function registerSubmitInputTool(server: McpServer): void {
  server.tool(
    'submit_input',
    'Resume a paused checkout session with user-provided input (OTP, variant, captcha, etc.)',
    {
      session_id: z.string().describe('The paused session ID'),
      value: z.string().describe('The input value (OTP code, variant choice, etc.)'),
    },
    async ({ session_id, value }) => {
      try {
        const session = sessions.get(session_id);
        if (!session) {
          return toolResult({
            summary: `Session ${session_id} not found`,
            status: 'not_found',
            data: null,
          }, true);
        }
        if (session.state !== 'need_input') {
          return toolResult({
            summary: `Session ${session_id} is not waiting for input (state: ${session.state})`,
            status: 'error',
            data: { current_state: session.state },
          }, true);
        }

        const resolve = session.data.resolve as ((value: string) => void) | undefined;
        if (!resolve) {
          return toolResult({
            summary: 'Session has no pending input handler',
            status: 'error',
            data: null,
          }, true);
        }

        resolve(value);
        sessions.update(session_id, {
          state: 'resuming',
          data: { ...session.data, resolve: undefined },
        });

        return toolResult({
          summary: `Input submitted to session ${session_id}`,
          status: 'success',
          data: { session_id, state: 'resuming' },
        });
      } catch (error) {
        return toolResult({
          summary: `Failed to submit input: ${(error as Error).message}`,
          status: 'error',
          data: null,
        }, true);
      }
    }
  );
}
