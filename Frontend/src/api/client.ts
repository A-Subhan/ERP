/* ===========================================================================
 * API client — wraps fetch with credentials, CSRF header, JSON helpers.
 * ==========================================================================*/
export interface ApiError { error: string; details?: unknown; }

function getToken(): string | null {
  // CSRF token issued by server via X-CSRF-Token header on safe requests;
  // we capture it and replay it on mutating requests.
  // Stored in module-scope after first GET.
  return (window as any).__csrfToken || null;
}

let setTokenFromResponse: (res: Response) => void = (res) => {
  const t = res.headers.get('X-CSRF-Token');
  if (t) (window as any).__csrfToken = t;
};

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['x-csrf-token'] = token;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error('Network error. Check your connection and try again.');
  }

  setTokenFromResponse(res);

  // Empty body
  const txt = await res.text();
  const data = txt ? JSON.parse(txt) : null;

  if (!res.ok) {
    const err = (data as ApiError) || { error: `Request failed (${res.status}).` };
    throw new Error(err.error || 'Request failed.');
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put:  <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del:  <T>(url: string) => request<T>('DELETE', url),
};

/** Trigger a browser download for a server-generated file (PDF/Excel/CSV/Word). */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['x-csrf-token'] = token;
  const res = await fetch(url, { method: 'GET', headers, credentials: 'same-origin' });
  if (!res.ok) throw new Error('Export failed.');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  const cd = res.headers.get('content-disposition');
  const m = cd && cd.match(/filename="?([^";]+)"?/i);
  a.download = (m && m[1]) || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
