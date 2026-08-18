import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { revokeRefreshToken, REFRESH_COOKIE } from "@/lib/auth/refreshToken";

export async function POST() {
  const cookieStore = await cookies();

  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (refreshToken) await revokeRefreshToken(refreshToken);

  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete({ name: REFRESH_COOKIE, path: "/api/auth" });
  return NextResponse.json({ ok: true });
}
