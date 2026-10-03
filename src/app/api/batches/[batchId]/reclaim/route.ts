import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveBatchAccess } from "@/lib/auth/batchAccess";
import { errorResponse } from "@/lib/distribution/http";
import { prepareReclaim } from "@/lib/distribution/reclaim";

const bodySchema = z.object({ idempotencyKey: z.string().min(8).max(100) });

/** Prepares one run that takes back every expired, unclaimed balance. */
export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { publicKey } = await resolveBatchAccess();
  if (!publicKey) return NextResponse.json({ error: "Connect your wallet first" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "idempotencyKey is required" }, { status: 400 });
  const { batchId } = await params;
  try {
    const p = await prepareReclaim(batchId, publicKey, parsed.data.idempotencyKey);
    return NextResponse.json({ runId: p.runId, setupXdr: p.setupXdr, transactionCount: p.transactionCount, count: p.count });
  } catch (err) {
    return errorResponse(err);
  }
}
