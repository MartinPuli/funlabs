import { NextResponse } from 'next/server';
import { workerClient } from '@/lib/supabase/worker';
import { bearer } from '@/lib/tokens';
import { AgentError, authenticateAgent } from '@/lib/agent/auth';
import { executeTool, TOOL_BY_NAME } from '@/lib/agent/tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function errorResponse(err: unknown) {
  if (err instanceof AgentError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, { status: err.status });
  }
  console.error('[agent]', err);
  return NextResponse.json({ error: { code: 'server_error', message: 'Falló de nuestro lado. Reintentar.' } }, { status: 500 });
}

/** REST form of a tool: POST /api/agent/<tool> with `Authorization: Bearer fla_...` and a JSON body. */
export async function POST(request: Request, ctx: { params: Promise<{ tool: string }> }) {
  const { tool } = await ctx.params;
  try {
    if (!TOOL_BY_NAME.has(tool)) throw new AgentError('unknown_tool', `Herramienta desconocida: ${tool}`, 404);
    const worker = await workerClient();
    const actor = await authenticateAgent(worker, bearer(request.headers.get('authorization')));
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const out = await executeTool(worker, actor, tool, body, 'rest');
    return NextResponse.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
