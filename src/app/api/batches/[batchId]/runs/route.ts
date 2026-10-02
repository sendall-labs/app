import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveBatchAccess } from "@/lib/auth/batchAccess";
import { prisma } from "@/lib/db/prisma";
import { prepareBatchRun } from "@/lib/distribution/batchRuns";
import { errorResponse } from "@/lib/distribution/http";

const bodySchema = z.object({ idempotencyKey: z.string().min(8).max(100) });

/**
 * Prepares a channel-engine run for the batch's ready rows and returns
 * the one setup transaction the wallet must sign. Only the wallet that
 * owns the batch can prepare it, since it is the account being debited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { publicKey } = await resolveBatchAccess();
  if (!publicKey) return NextResponse.json({ error: "Connect your wallet first" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "idempotencyKey is required" }, { status: 400 });

  const { batchId } = await params;
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, ownerPublicKey: publicKey },
    include: { recipients: true },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  if (batch.sourceAccount !== publicKey) {
    return NextResponse.json({ error: "This batch is set to send from another account" }, { status: 403 });
  }

  try {
    const prepared = await prepareBatchRun({ batch, idempotencyKey: parsed.data.idempotencyKey });
    const included = await prisma.recipient.findMany({
      where: { channelItems: { some: { transaction: { runId: prepared.runId } } } },
      select: { amount: true },
    });
    const total = included.reduce((sum, r) => sum + Number(r.amount), 0);
    return NextResponse.json({
      runId: prepared.runId,
      status: prepared.status,
      setupXdr: prepared.setupXdr,
      transactionCount: prepared.transactionCount,
      summary: {
        recipientCount: included.length,
        totalAmount: total.toFixed(7).replace(/\.?0+$/, ""),
        asset: batch.assetCode ?? "XLM",
        network: batch.network,
        kind: batch.kind,
      },
      preflight: prepared.preflight ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
