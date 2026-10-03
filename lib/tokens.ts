import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Prefixes make leaked tokens recognizable: flt = tester invite, fla = agent. */
export type TokenKind = 'flt' | 'fla';

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newToken(kind: TokenKind): { token: string; hash: string; hint: string } {
  const token = `${kind}_${randomBytes(24).toString('base64url')}`;
  return { token, hash: hashToken(token), hint: token.slice(-4) };
}

export function looksLikeToken(value: string | null | undefined, kind: TokenKind): value is string {
  return typeof value === 'string' && new RegExp(`^${kind}_[A-Za-z0-9_-]{20,64}$`).test(value);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function bearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
