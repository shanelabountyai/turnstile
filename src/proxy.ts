import { NextResponse, type NextRequest } from 'next/server';
import { admit } from '@/checkout/gate';

// Turnstile D-46: every route of a deployed demo sits behind the shared demo password (core's gate, v1.6.5), except the
// routes that carry a credential of their own (`ownCredential` in src/checkout/gate.ts). Off Vercel with no password
// (dev, CI, e2e) the gate is open and this does nothing. Not access control: /demo behind it signs anyone in.
export function proxy(req: NextRequest) {
  return admit(req.nextUrl.pathname, req.headers.get('authorization')) ?? NextResponse.next();
}

// Static files hold nothing private.
export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
