import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { API, clearSession, csrfOk, RT } from '@/lib/server-session';

export async function POST(req: Request) {
  if (!csrfOk(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Bad request.' } }, { status: 403 });
  const rt = cookies().get(RT)?.value;
  if (rt) {
    await fetch(`${API}/v1/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }).catch(() => undefined);
  }
  const res = NextResponse.json({ ok: true });
  clearSession(res);
  return res;
}
