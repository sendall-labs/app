import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

// JWT signature isn't verified here (that happens per-request in API
// routes/server components via verifySession) — this only gates on
// cookie presence to redirect logged-out visitors before rendering.
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/batches/:path*"],
};
