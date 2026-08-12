import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "./session";

/** Returns the authenticated wallet's public key, or null if not logged in. */
export async function getSessionPublicKey(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  return session?.sub ?? null;
}
