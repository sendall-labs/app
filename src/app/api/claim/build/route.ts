import { NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { buildClaimTx } from "@/lib/distribution/claimPage";
import { errorResponse } from "@/lib/distribution/http";

const body = z.object({
  address: z.string().refine((v) => StrKey.isValidEd25519PublicKey(v), "Invalid address"),
  network: z.enum(["TESTNET", "PUBLIC"]),
  balanceIds: z.array(z.string().regex(/^[0-9a-f]{72}$/)).min(1).max(100),
});

/** Builds the recipient's claim transaction (trustlines + claims) for their wallet to sign. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid claim request" }, { status: 400 });
  try {
    return NextResponse.json(await buildClaimTx(parsed.data.network, parsed.data.address, parsed.data.balanceIds));
  } catch (err) {
    return errorResponse(err);
  }
}
