import { NextResponse } from "next/server";
import { Asset } from "@stellar/stellar-sdk";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db/prisma";
import { getRpcServer } from "@/lib/stellar/client";
import { buildPaymentChunks } from "@/lib/stellar/txBuilder";
import type { Network } from "@/generated/prisma/enums";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { batchId } = await params;
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, ownerPublicKey: publicKey },
    include: { recipients: true },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const readyRecipients = batch.recipients.filter((r) => r.status === "READY");
  if (readyRecipients.length === 0) {
    return NextResponse.json({ error: "No READY recipients to prepare" }, { status: 400 });
  }

  const network = batch.network as Network;
  const server = getRpcServer(network);
  const sourceAccount = await server.getAccount(batch.sourceAccount);
  const asset = batch.assetCode && batch.assetIssuer ? new Asset(batch.assetCode, batch.assetIssuer) : null;

  const chunks = buildPaymentChunks({
    network,
    sourceAccount,
    asset,
    recipients: readyRecipients.map((r) => ({
      recipientId: r.id,
      destination: r.destination,
      amount: r.amount.toString(),
      needsCreateAccount: !asset && r.accountExists === false,
    })),
  });

  const attempts = await prisma.$transaction(
    chunks.map((chunk) =>
      prisma.paymentAttempt.create({
        data: {
          batchId: batch.id,
          chunkIndex: chunk.chunkIndex,
          operationCount: chunk.operationCount,
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
    })),
  });
}
