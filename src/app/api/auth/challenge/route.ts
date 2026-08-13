import { NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { buildLoginChallenge } from "@/lib/stellar/siws";
import type { Network } from "@/generated/prisma/enums";

const bodySchema = z.object({
  publicKey: z.string().refine(
    (v) => StrKey.isValidEd25519PublicKey(v) || StrKey.isValidMed25519PublicKey(v),
    "Invalid Stellar public key"
  ),
  network: z.enum(["TESTNET", "PUBLIC"]),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { publicKey, network } = parsed.data;
  const challenge = buildLoginChallenge(publicKey, network as Network);
  return NextResponse.json({ challenge });
}
