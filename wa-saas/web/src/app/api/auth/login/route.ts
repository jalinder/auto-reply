import { NextResponse } from 'next/server';
import { API, csrfOk, setTokens } from '@/lib/server-session';

export async function POST(req: Request) {
  if (!csrfOk(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Bad request.' } }, { status: 403 });
  const body = await req.json();
  const r = await fetch(`${API}/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': req.headers.get('x-forwarded-for') ?? '' },
    body: JSON.stringify({ email: body.email, password: body.password, deviceId: 'web' }), cache: 'no-store',
  });
  const json = await r.json();
  if (!r.ok) return NextResponse.json(json, { status: r.status });
  if (json.otpRequired) return NextResponse.json({ otpRequired: true, challengeId: json.challengeId, expiresIn: json.expiresIn });
  const res = NextResponse.json({ ok: true });
  setTokens(res, json);
  return res;
}
