import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const API = process.env.API_BASE_URL ?? 'http://localhost:4000';
export const AT = 'wa_at';
export const RT = 'wa_rt';
export const TID = 'wa_tid';
const secure = process.env.NODE_ENV === 'production';

export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number }

export function setTokens(res: NextResponse, t: TokenPair) {
  res.cookies.set(AT, t.accessToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: t.expiresIn - 30 });
  res.cookies.set(RT, t.refreshToken, { httpOnly: true, secure, sameSite: 'strict', path: '/api', maxAge: 30 * 86400 });
}

export function clearSession(res: NextResponse) {
  for (const n of [AT, TID]) res.cookies.set(n, '', { path: '/', maxAge: 0 });
  res.cookies.set(RT, '', { path: '/api', maxAge: 0 });
}

export function setWorkspace(res: NextResponse, tenantId: string) {
  res.cookies.set(TID, tenantId, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 365 * 86400 });
}

export async function refreshTokens(): Promise<TokenPair | null> {
  const rt = cookies().get(RT)?.value;
  if (!rt) return null;
  const r = await fetch(`${API}/v1/auth/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }), cache: 'no-store',
  });
  return r.ok ? ((await r.json()) as TokenPair) : null;
}

export function csrfOk(req: Request) {
  return req.method === 'GET' || req.method === 'HEAD' || req.headers.get('x-requested-with') === 'wasaas';
}
