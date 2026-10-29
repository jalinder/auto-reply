import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { API, AT, clearSession, csrfOk, refreshTokens, setTokens, TID, TokenPair } from '@/lib/server-session';

export const dynamic = 'force-dynamic';
const FORWARD = ['content-type', 'idempotency-key', 'x-step-up-token', 'accept'];

async function handle(req: Request, { params }: { params: { path: string[] } }) {
  if (!csrfOk(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Bad request.' } }, { status: 403 });
  const path = params.path.map(encodeURIComponent).join('/');
  if (!path.startsWith('v1/') || path.startsWith('v1/webhooks') || path.startsWith('v1/auth/refresh')) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, { status: 404 });
  }
  const url = `${API}/${path}${new URL(req.url).search}`;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();

  const send = (token: string | undefined) => {
    const h = new Headers();
    for (const k of FORWARD) { const v = req.headers.get(k); if (v) h.set(k, v); }
    if (token) h.set('Authorization', `Bearer ${token}`);
    const tid = cookies().get(TID)?.value;
    if (tid) h.set('X-Tenant-Id', tid);
    return fetch(url, { method: req.method, headers: h, body, cache: 'no-store', // @ts-expect-error node fetch streaming option
      duplex: 'half' });
  };

  let refreshed: TokenPair | null = null;
  let upstream = await send(cookies().get(AT)?.value);
  if (upstream.status === 401) {
    refreshed = await refreshTokens();
    if (!refreshed) {
      const res = NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } }, { status: 401 });
      clearSession(res);
      return res;
    }
    upstream = await send(refreshed.accessToken);
  }

  const headers = new Headers();
  for (const k of ['content-type', 'content-disposition', 'cache-control', 'x-request-id']) {
    const v = upstream.headers.get(k); if (v) headers.set(k, v);
  }
  const res = new NextResponse(upstream.body, { status: upstream.status, headers });
  if (refreshed) setTokens(res, refreshed);
  return res;
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE, handle as PUT };
