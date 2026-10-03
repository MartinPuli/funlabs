/**
 * Builds run sandboxed: opaque origin (no FUNLABS cookies or storage), no
 * network, embeddable only by FUNLABS pages. Agent-modified code cannot
 * exfiltrate data or act as the participant.
 */
export const GAME_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export function gameResponse(html: string, opts: { immutable: boolean; sha256?: string }) {
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': GAME_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': opts.immutable ? 'public, max-age=31536000, immutable' : 'private, no-store',
      ...(opts.sha256 ? { 'X-Funlabs-Version-Sha256': opts.sha256 } : {}),
    },
  });
}

export function notFound(message = 'No encontrado') {
  return new Response(message, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
