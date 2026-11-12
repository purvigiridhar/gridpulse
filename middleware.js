import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const HOME = { ADMIN: '/dashboard/admin', PROSUMER: '/dashboard/prosumer' };

const isWithin = (pathname, base) => pathname === base || pathname.startsWith(`${base}/`);

/**
 * Route guard (runs on the Edge, so it only reads the signed JWT; API routes
 * still enforce their own authorization server-side).
 *  - /dashboard/admin/*    -> ADMIN only
 *  - /dashboard/prosumer/* -> PROSUMER only
 *  - /dashboard            -> bounced to the role's home
 *  - /login                -> signed-in users are sent to their dashboard
 */
export async function middleware(req) {
  const { pathname } = req.nextUrl;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const role = token?.user_role;
  const home = HOME[role];

  if (pathname === '/login') {
    return home ? NextResponse.redirect(new URL(home, req.url)) : NextResponse.next();
  }

  if (!token || !home) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === '/dashboard') {
    return NextResponse.redirect(new URL(home, req.url));
  }
  if (isWithin(pathname, '/dashboard/admin') && role !== 'ADMIN') {
    return NextResponse.redirect(new URL(home, req.url));
  }
  if (isWithin(pathname, '/dashboard/prosumer') && role !== 'PROSUMER') {
    return NextResponse.redirect(new URL(home, req.url));
  }

  return NextResponse.next();
}

export const config = { matcher: ['/login', '/dashboard/:path*'] };
