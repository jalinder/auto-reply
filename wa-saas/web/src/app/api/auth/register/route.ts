import { NextResponse } from 'next/server';
import { API, csrfOk, setTokens } from '@/lib/server-session';

export async function POST(req: Request) {
  if (!csrfOk(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Bad request.' } }, { status: 403 });
  const r = await fetch(`${API}/v1/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await req.text(), cache: 'no-store',
  });
  const json = await r.json();
  if (!r.ok) return NextResponse.json(json, { status: r.status });
  const res = NextResponse.json({ ok: true });
  setTokens(res, json);
  return res;
}
