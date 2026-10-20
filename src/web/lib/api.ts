/** Dünne Schicht über fetch: JSON, CSRF-Header, verständliche Fehler. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[] | null;

async function request<T>(method: string, url: string, body?: Json | string | Blob, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { accept: 'application/json', ...headers }, credentials: 'same-origin' };
  if (method !== 'GET' && method !== 'HEAD') (init.headers as Record<string, string>)['x-filum'] = '1';
  if (body !== undefined) {
    if (typeof body === 'string' || body instanceof Blob) init.body = body;
    else {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
    }
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, 'network', 'Keine Verbindung zum Server. Bitte Netzwerk prüfen und erneut versuchen.');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; field?: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && !url.endsWith('/login')) window.dispatchEvent(new CustomEvent('filum:unauthorized'));
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Anfrage fehlgeschlagen (HTTP ${res.status}).`, err?.field, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: Json) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: Json) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
  raw: <T>(method: string, url: string, body: string | Blob, contentType: string) => request<T>(method, url, body, { 'content-type': contentType }),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
