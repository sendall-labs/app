import { NextResponse } from "next/server";
import { batchAccessWhere, resolveBatchAccess } from "@/lib/auth/batchAccess";
import { prisma } from "@/lib/db/prisma";
import { syncClaimStatuses } from "@/lib/distribution/claims";
import { errorResponse } from "@/lib/distribution/http";

export const maxDuration = 60;

/** Refreshes claimed / reclaimed status of the batch's claimable balances from Horizon. */
export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const access = await resolveBatchAccess();
  const { batchId } = await params;
  const batch = await prisma.batch.findFirst({ where: { id: batchId, ...batchAccessWhere(access) }, select: { id: true, kind: true } });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  if (batch.kind !== "CLAIMABLE_BALANCE") return NextResponse.json({ error: "Not a claimable balance batch" }, { status: 400 });
  try {
    return NextResponse.json({ claims: await syncClaimStatuses(batchId) });
  } catch (err) {
    return errorResponse(err);
  }
}
