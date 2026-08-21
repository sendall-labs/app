import { NextResponse } from "next/server";
import { Asset } from "@stellar/stellar-sdk";
import { resolveBatchAccess, batchAccessWhere } from "@/lib/auth/batchAccess";
import { prisma } from "@/lib/db/prisma";
import { checkRecipients } from "@/lib/stellar/balanceCheck";
import { getRpcServer } from "@/lib/stellar/client";
import { buildPaymentChunks } from "@/lib/stellar/txBuilder";
import type { Network } from "@/generated/prisma/enums";

/**
 * Re-checks and re-submits only FAILED recipients. Successful recipients
 * from prior attempts are never touched — this creates a fresh
 * PaymentAttempt/Item set scoped to the failures only.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const access = await resolveBatchAccess();

  const { batchId } = await params;
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, ...batchAccessWhere(access) },
    include: { recipients: true },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  if (!batch.sourceAccount) {
    return NextResponse.json(
      { error: "Connect a wallet to claim this batch before retrying it" },
      { status: 409 }
    );
  }

  const failed = batch.recipients.filter((r) => r.status === "FAILED");
  if (failed.length === 0) {
    return NextResponse.json({ error: "No FAILED recipients to retry" }, { status: 400 });
  }

  const network = batch.network as Network;
  const asset = batch.assetCode && batch.assetIssuer ? new Asset(batch.assetCode, batch.assetIssuer) : null;

  let retryableIds: string[] = [];

  try {
    const checkResults = await checkRecipients(
      network,
      failed.map((r) => ({ destination: r.destination, amount: r.amount.toString() })),
      asset
    );

    await prisma.$transaction(
      failed.map((r) => {
        const result = checkResults.get(r.destination);
        const ok = result?.ok ?? false;
        return prisma.recipient.update({
          where: { id: r.id },
          data: {
            accountExists: result?.accountExists ?? false,
            hasTrustline: result?.hasTrustline ?? null,
            trustlineLimitOk: result?.trustlineLimitOk ?? null,
            status: ok ? "READY" : "CHECK_FAILED",
            errorMessage: ok ? null : result?.reason,
          },
        });
      })
    );

    const stillFailing = failed.filter((r) => !(checkResults.get(r.destination)?.ok ?? false));
    const retryable = failed.filter((r) => checkResults.get(r.destination)?.ok ?? false);
    retryableIds = retryable.map((r) => r.id);

    if (retryable.length === 0) {
      return NextResponse.json({ attempts: [], stillFailing: stillFailing.length });
    }

    const server = getRpcServer(network);
    const sourceAccount = await server.getAccount(batch.sourceAccount);

    const chunks = buildPaymentChunks({
      network,
      sourceAccount,
      asset,
      recipients: retryable.map((r) => ({
        recipientId: r.id,
        destination: r.destination,
        amount: r.amount.toString(),
        needsCreateAccount: !asset && checkResults.get(r.destination)?.needsCreateAccount === true,
      })),
    });

    const existingAttemptCount = await prisma.paymentAttempt.count({ where: { batchId: batch.id } });

    const attempts = await prisma.$transaction(
      chunks.map((chunk, i) =>
        prisma.paymentAttempt.create({
          data: {
            batchId: batch.id,
            chunkIndex: existingAttemptCount + i,
            operationCount: chunk.operationCount,
            requiresSignature: chunk.requiresSignature,
            status: "BUILT",
            xdrEnvelope: chunk.xdr,
            items: {
              create: chunk.items.map((item) => ({
                recipientId: item.recipientId,
                operationIndex: item.operationIndex,
                status: "BUILT",
              })),
            },
          },
        })
      )
    );

    await prisma.batch.update({ where: { id: batch.id }, data: { status: "SUBMITTING" } });

    return NextResponse.json({
      attempts: attempts.map((a) => ({
        attemptId: a.id,
        chunkIndex: a.chunkIndex,
        xdr: a.xdrEnvelope,
        operationCount: a.operationCount,
        requiresSignature: a.requiresSignature,
      })),
      stillFailing: stillFailing.length,
    });
  } catch (err) {
    // Recipients this retry marked READY (via the check above) but never got
    // a payment attempt built for — send them back to FAILED so "Retry
    // failed" is available again instead of silently stranding them as READY
    // with no attempt in flight.
    if (retryableIds.length > 0) {
      await prisma.recipient.updateMany({
        where: { id: { in: retryableIds } },
        data: { status: "FAILED" },
      });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Retry failed" },
      { status: 500 }
    );
  }
}
