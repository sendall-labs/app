import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveBatchAccess, batchAccessWhere } from "@/lib/auth/batchAccess";
import { prisma } from "@/lib/db/prisma";
import { cancelRun } from "@/lib/distribution/engine";

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
          // Latest first: what happened to the row in the channel engine.
          channelItems: {
            orderBy: { id: "desc" },
            select: { status: true, resultCode: true, transaction: { select: { stellarTxHash: true, transactionHash: true } } },
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

const patchSchema = z
  .object({
    network: z.enum(["TESTNET", "PUBLIC"]).optional(),
    assetCode: z.string().optional(),
    assetIssuer: z.string().optional(),
    // Payment <-> claimable balance, switchable until a run is signed.
    kind: z.enum(["PAYMENT", "CLAIMABLE_BALANCE"]).optional(),
  })
  .refine((v) => v.network !== undefined || v.kind !== undefined, "Nothing to change");

const DEFAULT_CLAIM_DAYS = 30;

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
  const { network, assetCode, assetIssuer, kind } = parsed.data;

  const { batchId } = await params;
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, ...batchAccessWhere(access) },
    include: { _count: { select: { attempts: true, runs: { where: { signedAt: { not: null } } } } } },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  // Once a wallet has authorized anything, what was signed is fixed.
  if (batch._count.attempts > 0 || batch._count.runs > 0) {
    return NextResponse.json(
      { error: "Can't change the network, asset or type after signing has started" },
      { status: 409 }
    );
  }

  // A run waiting for a signature was built for the old settings; end it
  // so it can never be approved by mistake.
  const waiting = await prisma.distributionRun.findMany({
    where: { batchId: batch.id, status: "AWAITING_USER_SIGNATURE" },
    select: { id: true },
  });
  for (const run of waiting) await cancelRun(run.id);

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
    const nextKind = kind ?? batch.kind;
    await tx.batch.update({
      where: { id: batch.id },
      data: {
        ...(network !== undefined ? { network, assetCode: assetCode || null, assetIssuer: assetIssuer || null } : {}),
        kind: nextKind,
        claimExpiresAt:
          nextKind === "CLAIMABLE_BALANCE"
            ? (batch.claimExpiresAt ?? new Date(Date.now() + DEFAULT_CLAIM_DAYS * 86_400_000))
            : null,
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
