import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db/prisma";
import { parseRecipientsCsv } from "@/lib/csv/parse";
import { validateRecipients } from "@/lib/stellar/validation";

const bodySchema = z.object({
  csvText: z.string().min(1),
});

/**
 * Replaces a batch's recipient list wholesale — used when the user edits
 * addresses/amounts from the review screen instead of starting a new batch.
 * Only allowed before anything has been prepared/sent: once a
 * PaymentAttempt exists, the recipient set (and its row indexes, which
 * attempts reference) is frozen.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { batchId } = await params;
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, ownerPublicKey: publicKey },
    include: { _count: { select: { attempts: true } } },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  if (batch._count.attempts > 0) {
    return NextResponse.json(
      { error: "Can't edit recipients after signing has started" },
      { status: 409 }
    );
  }

  const { rows, errors: parseErrors, truncated } = parseRecipientsCsv(parsed.data.csvText);
  const validated = validateRecipients(rows);

  const updatedBatch = await prisma.$transaction(async (tx) => {
    await tx.recipient.deleteMany({ where: { batchId: batch.id } });
    await tx.batch.update({
      where: { id: batch.id },
      data: {
        status: "VALIDATED",
        recipients: {
          create: validated.map((r) => ({
            rowIndex: r.rowIndex,
            destination: r.destination,
            amount: r.amount,
            memo: r.memo,
            addressValid: r.addressValid,
            isDuplicate: r.isDuplicate,
            status: r.addressValid && r.amountValid ? "PENDING" : "VALIDATION_FAILED",
            errorMessage: r.errorMessage,
          })),
        },
      },
    });
    return tx.batch.findUniqueOrThrow({
      where: { id: batch.id },
      include: { recipients: { orderBy: { rowIndex: "asc" } }, attempts: { include: { items: true } } },
    });
  });

  return NextResponse.json({ batch: updatedBatch, parseErrors, truncated });
}
