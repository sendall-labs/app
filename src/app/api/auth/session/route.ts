import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { signSession, verifySession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { rotateRefreshToken, REFRESH_COOKIE, REFRESH_TTL_SECONDS } from "@/lib/auth/refreshToken";

export async function GET() {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";

  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionToken) {
    const session = await verifySession(sessionToken);
    if (session) return NextResponse.json({ publicKey: session.sub });
  }

  // Access token missing or expired — fall back to the refresh token so a
  // returning visitor doesn't have to sign with their wallet again. The
  // refresh token is single-use: a valid one silently mints a new access
  // token and rotates in a new refresh token.
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return NextResponse.json({ publicKey: null });

  const rotated = await rotateRefreshToken(refreshToken);
  if (!rotated) {
    cookieStore.delete({ name: REFRESH_COOKIE, path: "/api/auth" });
    return NextResponse.json({ publicKey: null });
  }

  const newSessionToken = await signSession({ sub: rotated.ownerPublicKey });
  cookieStore.set(SESSION_COOKIE, newSessionToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  cookieStore.set(REFRESH_COOKIE, rotated.raw, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: REFRESH_TTL_SECONDS,
  });

  return NextResponse.json({ publicKey: rotated.ownerPublicKey });
}
