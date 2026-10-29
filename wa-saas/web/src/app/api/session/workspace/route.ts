import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { csrfOk, setWorkspace, TID } from '@/lib/server-session';

export async function GET() {
  return NextResponse.json({ tenantId: cookies().get(TID)?.value ?? null });
}

export async function POST(req: Request) {
  if (!csrfOk(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Bad request.' } }, { status: 403 });
  const { tenantId } = await req.json();
  if (typeof tenantId !== 'string' || tenantId.length > 36) return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid workspace.' } }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  setWorkspace(res, tenantId); // membership is verified by the API on every request
  return res;
}
