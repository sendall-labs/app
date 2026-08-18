import { NextResponse } from "next/server";
import { Asset } from "@stellar/stellar-sdk";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db/prisma";
import { checkRecipients } from "@/lib/stellar/balanceCheck";
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

  const candidates = batch.recipients.filter(
    (r) => r.addressValid && !r.isDuplicate && r.status === "PENDING"
  );
  if (candidates.length === 0) {
    return NextResponse.json({ checked: 0 });
  }

  const previousStatus = batch.status;
  await prisma.batch.update({ where: { id: batch.id }, data: { status: "CHECKING" } });

  const asset = batch.assetCode && batch.assetIssuer ? new Asset(batch.assetCode, batch.assetIssuer) : null;

  try {
    const results = await checkRecipients(
      batch.network as Network,
      candidates.map((r) => ({ destination: r.destination, amount: r.amount.toString() })),
      asset
    );

    await prisma.$transaction(
      candidates.map((r) => {
        const result = results.get(r.destination);
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

    const finalRecipients = await prisma.recipient.findMany({ where: { batchId: batch.id } });
    const anyReady = finalRecipients.some((r) => r.status === "READY");
    await prisma.batch.update({
      where: { id: batch.id },
      data: { status: anyReady ? "READY" : "FAILED" },
    });

    return NextResponse.json({ checked: candidates.length });
  } catch (err) {
    await prisma.batch.update({ where: { id: batch.id }, data: { status: previousStatus } });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Check failed" },
      { status: 500 }
    );
  }
}
