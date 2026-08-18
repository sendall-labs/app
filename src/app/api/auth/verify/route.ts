import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { verifyLoginMessage } from "@/lib/stellar/siws";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import { issueRefreshToken, REFRESH_COOKIE, REFRESH_TTL_SECONDS } from "@/lib/auth/refreshToken";

const bodySchema = z.object({
  publicKey: z.string().refine(
    (v) => StrKey.isValidEd25519PublicKey(v) || StrKey.isValidMed25519PublicKey(v),
    "Invalid Stellar public key"
  ),
  signedMessage: z.string(),
  token: z.string(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  let publicKey: string;
  try {
    publicKey = await verifyLoginMessage(parsed.data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Challenge verification failed" },
      { status: 401 }
    );
  }

  const sessionToken = await signSession({ sub: publicKey });
  const refreshToken = await issueRefreshToken(publicKey);

  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";
  cookieStore.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  cookieStore.set(REFRESH_COOKIE, refreshToken.raw, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: REFRESH_TTL_SECONDS,
  });

  return NextResponse.json({ publicKey });
}
