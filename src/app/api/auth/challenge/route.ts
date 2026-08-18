import { NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { buildLoginMessage } from "@/lib/stellar/siws";

const bodySchema = z.object({
  publicKey: z.string().refine(
    (v) => StrKey.isValidEd25519PublicKey(v) || StrKey.isValidMed25519PublicKey(v),
    "Invalid Stellar public key"
  ),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { message, token } = await buildLoginMessage(parsed.data.publicKey);
  return NextResponse.json({ message, token });
}
