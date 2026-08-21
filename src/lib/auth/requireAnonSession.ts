import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { signAnon, verifyAnon, ANON_COOKIE, ANON_TTL_SECONDS } from "./anonSession";

/**
 * Returns the current anonymous-session id, minting and cookie-ing a new one
 * if the visitor doesn't have one yet. Route Handlers (unlike Server
 * Components) can write cookies, so this can run on any batch route.
 */
export async function getOrCreateAnonId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(ANON_COOKIE)?.value;
  if (existing) {
    const payload = await verifyAnon(existing);
    if (payload) return payload.sub;
  }

  const anonId = randomUUID();
  const token = await signAnon({ sub: anonId });
  cookieStore.set(ANON_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ANON_TTL_SECONDS,
  });
  return anonId;
}

/** Reads the anonymous-session id without creating one. */
export async function peekAnonId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ANON_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyAnon(token);
  return payload?.sub ?? null;
}
