import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveBatchAccess, batchAccessWhere } from "@/lib/auth/batchAccess";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const access = await resolveBatchAccess();

  const { batchId } = await params;
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, ...batchAccessWhere(access) },
    include: {
      recipients: {
        orderBy: { rowIndex: "asc" },
        include: {
          // Channel engine: the transaction each delivered row went out in.
          channelItems: {
            where: { status: "SUCCESS" },
            select: { transaction: { select: { stellarTxHash: true, transactionHash: true } } },
          },
        },
      },
      attempts: { orderBy: { chunkIndex: "asc" }, include: { items: true } },
      runs: {
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, purpose: true, errorCode: true, signedAt: true, createdAt: true },
      },
    },
  });

  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  return NextResponse.json({ batch });
}

const patchSchema = z.object({
  network: z.enum(["TESTNET", "PUBLIC"]),
  assetCode: z.string().optional(),
  assetIssuer: z.string().optional(),
});

/**
 * Updates a batch's network/asset — the fields the New Batch form collects
 * up front, but that the Prepare tab lets you revisit before anything's
 * been signed. Balance/trustline checks are network+asset dependent, so any
 * change invalidates prior check results the same way editing recipients
 * does.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const access = await resolveBatchAccess();

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { network, assetCode, assetIssuer } = parsed.data;

  const { batchId } = await params;
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, ...batchAccessWhere(access) },
    include: { _count: { select: { attempts: true, runs: { where: { signedAt: { not: null } } } } } },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  // Once a wallet has authorized anything, what was signed is fixed.
  if (batch._count.attempts > 0 || batch._count.runs > 0) {
    return NextResponse.json(
      { error: "Can't edit network/asset after signing has started" },
      { status: 409 }
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.recipient.updateMany({
      where: { batchId: batch.id, addressValid: true, isDuplicate: false },
      data: {
        status: "PENDING",
        errorMessage: null,
        accountExists: null,
        currentBalance: null,
        hasTrustline: null,
        trustlineLimitOk: null,
      },
    });
    await tx.batch.update({
      where: { id: batch.id },
      data: {
        network,
        assetCode: assetCode || null,
        assetIssuer: assetIssuer || null,
        status: "VALIDATED",
      },
    });
    return tx.batch.findUniqueOrThrow({
      where: { id: batch.id },
      include: { recipients: { orderBy: { rowIndex: "asc" } }, attempts: { include: { items: true } } },
    });
  });

  return NextResponse.json({ batch: updated });
}
