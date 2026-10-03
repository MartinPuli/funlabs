import { NextResponse } from 'next/server';
import { toolCatalog } from '@/lib/agent/tools';
import { CAPABILITIES } from '@/lib/catalog';
import { env } from '@/lib/env';

export const dynamic = 'force-static';

/** Public tool catalogue: names, capabilities and input schemas. Calling a tool needs a work credential. */
export function GET() {
  return NextResponse.json({
    name: 'FUNLABS agent API',
    rest: `${env.siteUrl}/api/agent/{tool}`,
    mcp: `${env.siteUrl}/api/mcp`,
    auth: 'Authorization: Bearer fla_... (work credential limited by actor, study, capabilities and expiry)',
    payments_mode: 'test',
    capabilities: CAPABILITIES,
    tools: toolCatalog(),
  });
}
