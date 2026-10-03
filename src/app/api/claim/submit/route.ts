import { NextResponse } from "next/server";
import { z } from "zod";
import { submitClaimTx } from "@/lib/distribution/claimPage";
import { errorResponse } from "@/lib/distribution/http";

const body = z.object({ network: z.enum(["TESTNET", "PUBLIC"]), signedXdr: z.string().min(1).max(100_000) });

export const maxDuration = 60;

/** Submits a recipient-signed claim; only trustline and claim operations are accepted. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json(await submitClaimTx(parsed.data.network, parsed.data.signedXdr));
  } catch (err) {
    return errorResponse(err);
  }
}
