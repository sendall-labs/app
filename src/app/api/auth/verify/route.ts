import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { verifyLoginChallenge } from "@/lib/stellar/siws";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";
import type { Network } from "@/generated/prisma/enums";

const bodySchema = z.object({
  signedChallenge: z.string(),
  network: z.enum(["TESTNET", "PUBLIC"]),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  let publicKey: string;
  try {
    publicKey = verifyLoginChallenge(parsed.data.signedChallenge, parsed.data.network as Network);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Challenge verification failed" },
      { status: 401 }
    );
  }

  const token = await signSession({ sub: publicKey });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return NextResponse.json({ publicKey });
}
