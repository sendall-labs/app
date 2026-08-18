import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db/prisma";
import { submitAndPoll } from "@/lib/stellar/submit";
import type { Network } from "@/generated/prisma/enums";

const bodySchema = z.object({
  attemptId: z.string(),
  signedXdr: z.string(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { batchId } = await params;
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const batch = await prisma.batch.findFirst({ where: { id: batchId, ownerPublicKey: publicKey } });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const attempt = await prisma.paymentAttempt.findFirst({
    where: { id: parsed.data.attemptId, batchId: batch.id },
    include: { items: true },
  });
  if (!attempt) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });

  try {
    const result = await submitAndPoll(batch.network as Network, parsed.data.signedXdr);

    const attemptStatus = result.status === "SUCCESS" ? "SUCCESS" : "FAILED";
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: attemptStatus,
        txHash: result.hash,
        resultXdr: result.resultXdr,
        submittedAt: new Date(),
      },
    });

    const opResultByIndex = new Map(result.perOperation.map((r) => [r.operationIndex, r]));

    await prisma.$transaction(
      attempt.items.flatMap((item) => {
        const opResult = opResultByIndex.get(item.operationIndex);
        const success = opResult?.success ?? false;
        const itemStatus = success ? "SUCCESS" : "FAILED";
        return [
          prisma.paymentAttemptItem.update({
            where: { id: item.id },
            data: { status: itemStatus, resultCode: opResult?.code },
          }),
          prisma.recipient.update({
            where: { id: item.recipientId },
            data: { status: success ? "SUCCESS" : "FAILED", errorMessage: success ? null : opResult?.code },
          }),
        ];
      })
    );

    const recipients = await prisma.recipient.findMany({ where: { batchId: batch.id } });
    const hasFailed = recipients.some((r) => r.status === "FAILED");
    const allTerminal = recipients.every((r) => r.status === "SUCCESS" || r.status === "FAILED" || r.status === "VALIDATION_FAILED" || r.status === "CHECK_FAILED");
    const batchStatus = !allTerminal ? "SUBMITTING" : hasFailed ? "PARTIAL_FAILURE" : "COMPLETED";
    await prisma.batch.update({ where: { id: batch.id }, data: { status: batchStatus } });

    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Submit failed" },
      { status: 500 }
    );
  }
}
