'use client';

export type ApiError = { code: string; message: string };

export class TesterApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Calls a tester endpoint with the invite token. Errors carry a readable message. */
export async function testerCall<T>(token: string, action: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/tester/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new TesterApiError('network', 'No connection to FUNLABS. Check your network and try again.', 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: ApiError }).error;
    throw new TesterApiError(err?.code ?? 'error', err?.message ?? 'Something went wrong. Try again.', res.status);
  }
  return json as T;
}

/** Uploads to a Supabase signed upload URL with progress. */
export function uploadWithProgress(signedUrl: string, blob: Blob, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('Content-Type', blob.type || 'video/webm');
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload rejected (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('The connection dropped during the upload'));
    xhr.send(blob);
  });
}
