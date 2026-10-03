import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createUserClient } from '@/lib/supabase/server';

/** Completes sign-in from an email link (magic link or confirmation). */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = url.searchParams.get('next')?.startsWith('/') ? url.searchParams.get('next')! : '/lab';
  const supabase = await createUserClient();
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const code = url.searchParams.get('code');
  let error: string | null = null;
  if (tokenHash && type) {
    const res = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    error = res.error?.message ?? null;
  } else if (code) {
    const res = await supabase.auth.exchangeCodeForSession(code);
    error = res.error?.message ?? null;
  } else {
    error = 'Enlace incompleto';
  }
  const dest = new URL(error ? `/entrar?error=${encodeURIComponent('El enlace venció o ya se usó. Pedí uno nuevo.')}` : next, url.origin);
  return NextResponse.redirect(dest);
}
