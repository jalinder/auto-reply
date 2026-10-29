'use client';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: any) { super(message); }
}

type StepUpHandler = () => Promise<string | null>;
let stepUpHandler: StepUpHandler | null = null;
export function registerStepUpHandler(h: StepUpHandler) { stepUpHandler = h; }

export interface ApiOptions { method?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean }

export async function api<T = any>(path: string, opts: ApiOptions = {}, stepUpToken?: string): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'wasaas', ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (stepUpToken) headers['X-Step-Up-Token'] = stepUpToken;
  const res = await fetch(`/api/proxy${path}`, {
    method: opts.method ?? 'GET', headers, credentials: 'same-origin',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const e = json?.error ?? {};
    if (e.code === 'STEP_UP_REQUIRED' && stepUpHandler && !stepUpToken) {
      const token = await stepUpHandler();
      if (token) return api<T>(path, opts, token);
      throw new ApiError('STEP_UP_CANCELLED', 'Action cancelled.', 403);
    }
    throw new ApiError(e.code ?? 'HTTP_ERROR', e.message ?? 'Request failed.', res.status, e.details);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const fetcher = (path: string) => api(path);

export async function authPost(path: string, body: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wasaas' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json?.error?.code ?? 'HTTP_ERROR', json?.error?.message ?? 'Request failed.', res.status);
  return json;
}

/** Upload directly to private storage through a short-lived signed URL. */
export async function uploadFile(file: File, purpose: 'campaign' | 'import', onProgress?: (pct: number) => void) {
  const mimeType = file.type || (file.name.endsWith('.csv') ? 'text/csv' : file.name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : '');
  const slot = await api<{ mediaId: string; uploadUrl: string; headers: Record<string, string> }>('/v1/media/upload-url', {
    method: 'POST', body: { fileName: file.name, mimeType, sizeBytes: file.size, purpose },
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', slot.uploadUrl);
    Object.entries(slot.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new ApiError('UPLOAD_FAILED', 'Upload failed. Try again.', xhr.status)));
    xhr.onerror = () => reject(new ApiError('UPLOAD_FAILED', 'Upload failed. Check your connection.', 0));
    xhr.send(file);
  });
  return api<{ id: string; fileName: string; mimeType: string; sizeBytes: number }>(`/v1/media/${slot.mediaId}/complete`, { method: 'POST' });
}

export function newIdempotencyKey() {
  return `web-${crypto.randomUUID()}`;
}
