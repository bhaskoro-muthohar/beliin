export interface CardDetails {
  number: string;
  expiry: string;
  cvv: string;
  name: string;
}

export type ToolStatus = 'success' | 'error' | 'need_input' | 'not_found';

export interface ToolResponse {
  summary: string;
  status: ToolStatus;
  data: unknown;
}

export interface Session {
  id: string;
  state: string;
  createdAt: number;
  data: Record<string, unknown>;
}

export function toolResult(response: ToolResponse, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response) }],
    ...(isError && { isError: true as const }),
  };
}
