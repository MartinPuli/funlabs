import { NextResponse } from 'next/server';
import { workerClient } from '@/lib/supabase/worker';
import { bearer } from '@/lib/tokens';
import { AgentError, authenticateAgent } from '@/lib/agent/auth';
import { executeTool, toolCatalog, TOOL_BY_NAME } from '@/lib/agent/tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * MCP over Streamable HTTP, stateless JSON mode. It exposes exactly the same
 * tools as the REST API (one implementation, one set of rules). Every request
 * carries the work credential; there is no session to hijack.
 */
const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };

function rpcResult(id: Rpc['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
function rpcError(id: Rpc['id'], code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

async function handle(msg: Rpc, token: string | null): Promise<unknown | null> {
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case 'initialize': {
      const asked = String((msg.params as { protocolVersion?: string } | undefined)?.protocolVersion ?? '');
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'funlabs', title: 'FUNLABS: human evidence for your agent', version: '0.1.0' },
        instructions:
          'Tools to request evidence from playtests with people, prepare studies, submit agent work and compare versions. Authenticate every request with a work credential (Authorization: Bearer fla_...). Payments are in test mode.',
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, {
        tools: toolCatalog().map((t) => ({
          name: t.name,
          description: `${t.description} (capability: ${t.capability})`,
          inputSchema: { type: 'object', ...(t.input_schema as object) },
          annotations: { readOnlyHint: ['request_evidence', 'get_study', 'get_evidence', 'get_moment', 'compare_versions', 'get_export'].includes(t.name) },
        })),
      });
    case 'tools/call': {
      const name = String((msg.params as { name?: string } | undefined)?.name ?? '');
      const args = (msg.params as { arguments?: unknown } | undefined)?.arguments ?? {};
      if (!TOOL_BY_NAME.has(name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      try {
        const worker = await workerClient();
        const actor = await authenticateAgent(worker, token);
        const out = await executeTool(worker, actor, name, args, 'mcp');
        return rpcResult(msg.id, { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: false });
      } catch (err) {
        if (err instanceof AgentError) {
          const body = { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } };
          return rpcResult(msg.id, { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body, isError: true });
        }
        console.error('[mcp]', err);
        return rpcResult(msg.id, { content: [{ type: 'text', text: 'Something failed on our side. Try again.' }], isError: true });
      }
    }
    default:
      return isNotification ? null : rpcError(msg.id, -32601, `Unsupported method: ${msg.method}`);
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  // Browsers must not drive this endpoint with ambient credentials; agents send no Origin.
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json(rpcError(null, -32000, 'Origin not allowed'), { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Invalid JSON'), { status: 400 });
  }
  const token = bearer(request.headers.get('authorization'));
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as Rpc[];
  const responses: unknown[] = [];
  for (const m of messages) {
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
      responses.push(rpcError((m as Rpc | undefined)?.id, -32600, 'Invalid request'));
      continue;
    }
    const r = await handle(m, token);
    if (r !== null) responses.push(r);
  }
  if (!responses.length) return new Response(null, { status: 202 });
  return NextResponse.json(batch ? responses : responses[0]);
}

/** Stateless: no server-initiated stream. */
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
