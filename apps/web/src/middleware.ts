import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC = ["/", "/sign-in", "/sign-up", "/api/health", "/api/auth"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/auth")) return NextResponse.next();

  const sessionToken = getSessionCookie(request);
  if (!sessionToken) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/inventory/:path*",
    "/scans/:path*",
    "/documents/:path*",
    "/questionnaires/:path*",
    "/api/inventory/:path*",
    "/api/scans/:path*",
    "/api/documents/:path*",
    "/api/questionnaires/:path*",
    "/api/orgs",
    "/api/orgs/:path*",
  ],
};
