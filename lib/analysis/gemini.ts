/**
 * Minimal Gemini API client (generativelanguage.googleapis.com, v1beta):
 * resumable upload to the Files API, wait until processed, generate with a
 * JSON schema, delete the file afterwards.
 */
const BASE = 'https://generativelanguage.googleapis.com';

export type GeminiFile = { name: string; uri: string; mimeType: string; state: string };

export class GeminiError extends Error {
  status: number | undefined;
  retryable: boolean;
  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

async function gfetch(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 120_000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    throw new GeminiError(`No se pudo contactar a Gemini: ${err instanceof Error ? err.message : String(err)}`, undefined, true);
  } finally {
    clearTimeout(t);
  }
}

async function failure(res: Response, what: string): Promise<GeminiError> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message ?? JSON.stringify(body).slice(0, 300);
  } catch {
    detail = (await res.text().catch(() => '')).slice(0, 300);
  }
  return new GeminiError(`${what} (${res.status}): ${detail}`, res.status, res.status === 429 || res.status >= 500);
}

export async function uploadFile(apiKey: string, data: Uint8Array, mimeType: string, displayName: string): Promise<GeminiFile> {
  const start = await gfetch(`${BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(data.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
  });
  if (!start.ok) throw await failure(start, 'Gemini rechazó la subida');
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new GeminiError('Gemini no devolvió la URL de subida');
  const put = await gfetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Length': String(data.byteLength), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: data as unknown as BodyInit,
    timeoutMs: 300_000,
  });
  if (!put.ok) throw await failure(put, 'Gemini no recibió el archivo');
  const json = await put.json();
  return json.file as GeminiFile;
}

export async function waitUntilActive(apiKey: string, file: GeminiFile, timeoutMs = 180_000): Promise<GeminiFile> {
  const until = Date.now() + timeoutMs;
  let current = file;
  while (current.state !== 'ACTIVE') {
    if (current.state === 'FAILED') throw new GeminiError('Gemini no pudo procesar el video');
    if (Date.now() > until) throw new GeminiError('Gemini tardó demasiado en procesar el video', undefined, true);
    await new Promise((r) => setTimeout(r, 2500));
    const res = await gfetch(`${BASE}/v1beta/${current.name}`, { headers: { 'x-goog-api-key': apiKey } });
    if (!res.ok) throw await failure(res, 'No se pudo consultar el estado del video');
    current = (await res.json()) as GeminiFile;
  }
  return current;
}

export async function deleteFile(apiKey: string, name: string): Promise<void> {
  await gfetch(`${BASE}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': apiKey } }).catch(() => undefined);
}

export type GenerateResult = { json: unknown; text: string; usage: Record<string, unknown> | null; modelVersion: string | null };

export async function generateJson(
  apiKey: string,
  model: string,
  input: { system: string; parts: Array<{ text: string } | { file_data: { mime_type: string; file_uri: string } }>; schema: Record<string, unknown>; temperature?: number },
): Promise<GenerateResult> {
  const res = await gfetch(`${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: 'user', parts: input.parts }],
      generationConfig: {
        temperature: input.temperature ?? 0.2,
        responseMimeType: 'application/json',
        responseJsonSchema: input.schema,
      },
    }),
    timeoutMs: 240_000,
  });
  if (!res.ok) throw await failure(res, 'Gemini no generó el análisis');
  const body = await res.json();
  const candidate = body?.candidates?.[0];
  const text: string = (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  if (!text) {
    const reason = candidate?.finishReason ?? body?.promptFeedback?.blockReason ?? 'sin texto';
    throw new GeminiError(`Gemini no devolvió contenido (${reason})`, undefined, reason === 'MAX_TOKENS');
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GeminiError('La respuesta de Gemini no es JSON válido', undefined, true);
  }
  return { json, text, usage: body?.usageMetadata ?? null, modelVersion: body?.modelVersion ?? null };
}
