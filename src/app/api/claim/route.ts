import { NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { listClaimable } from "@/lib/distribution/claimPage";
import { errorResponse } from "@/lib/distribution/http";

const query = z.object({
  address: z.string().refine((v) => StrKey.isValidEd25519PublicKey(v), "Invalid address"),
  network: z.enum(["TESTNET", "PUBLIC"]),
  batch: z.string().max(40).optional(),
});

/** Public: balances waiting for an address. No session needed; claims are signed by the recipient. */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = query.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: "address and network are required" }, { status: 400 });
  try {
    return NextResponse.json(await listClaimable(parsed.data.network, parsed.data.address, parsed.data.batch));
  } catch (err) {
    return errorResponse(err);
  }
}
