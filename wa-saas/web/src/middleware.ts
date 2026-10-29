import { NextRequest, NextResponse } from 'next/server';

const PUBLIC = ['/login', '/register', '/forgot-password', '/reset-password', '/privacy', '/terms'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname === '/favicon.ico') return NextResponse.next();
  const hasSession = !!req.cookies.get('wa_at')?.value || !!req.cookies.get('wa_tid')?.value;
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
