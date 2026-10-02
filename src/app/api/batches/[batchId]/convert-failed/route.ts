import { NextResponse } from "next/server";
import { resolveBatchAccess } from "@/lib/auth/batchAccess";
import { convertFailedToClaimable } from "@/lib/distribution/convert";
import { errorResponse } from "@/lib/distribution/http";

/** "Send failed rows as claimable balance": new batch from rows that lacked a trustline or account. */
export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { publicKey } = await resolveBatchAccess();
  if (!publicKey) return NextResponse.json({ error: "Connect your wallet first" }, { status: 401 });
  const { batchId } = await params;
  try {
    return NextResponse.json(await convertFailedToClaimable(batchId, publicKey));
  } catch (err) {
    return errorResponse(err);
  }
}
