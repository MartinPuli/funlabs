import { NextResponse } from 'next/server';
import { getPlatformStatus } from '@/lib/status';

export const dynamic = 'force-dynamic';

/** Public, secret-free facts about this deployment. */
export async function GET() {
  return NextResponse.json(await getPlatformStatus());
}
