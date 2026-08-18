import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db/prisma";
import { validateRecipients } from "@/lib/stellar/validation";

const rowSchema = z.object({
  // Present + matching an existing row -> update in place (keeps the same
  // id, so the frontend's row identity — and input focus — survives an
  // autosave). Absent, or not found among the batch's current recipients
  // -> treated as a new row.
  id: z.string().optional(),
  destination: z.string(),
  amount: z.string(),
  memo: z.string().optional(),
});

const bodySchema = z.object({
  rows: z.array(rowSchema),
});

/**
 * Replaces a batch's recipient list — used when the user edits
 * addresses/amounts inline from the review screen instead of starting a
 * new batch. Diffs against the existing rows (update/create/delete) rather
 * than dropping and recreating everything, so unedited/edited-in-place
 * recipients keep their id.
 *
 * Only allowed before anything has been prepared/sent: once a
 * PaymentAttempt exists, the recipient set is frozen.
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
    include: { recipients: true, _count: { select: { attempts: true } } },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  if (batch._count.attempts > 0) {
    return NextResponse.json(
      { error: "Can't edit recipients after signing has started" },
      { status: 409 }
    );
  }

  const existingIds = new Set(batch.recipients.map((r) => r.id));
  const validated = validateRecipients(
    parsed.data.rows.map((r, i) => ({
      rowIndex: i + 1,
      destination: r.destination,
      amount: r.amount,
      memo: r.memo,
    }))
  );

  const submittedIds = new Set(
    parsed.data.rows.map((r) => r.id).filter((id): id is string => !!id && existingIds.has(id))
  );
  const idsToDelete = [...existingIds].filter((id) => !submittedIds.has(id));

  try {
    const updatedBatch = await prisma.$transaction(async (tx) => {
      if (idsToDelete.length > 0) {
        await tx.recipient.deleteMany({ where: { id: { in: idsToDelete } } });
      }

      for (let i = 0; i < parsed.data.rows.length; i++) {
        const input = parsed.data.rows[i];
        const v = validated[i];
        const data = {
          rowIndex: i + 1,
          destination: v.destination,
          // `amount` is a required Decimal column — an empty or non-numeric
          // draft (still being typed, or just garbage) can't be stored
          // as-is. The row is already flagged VALIDATION_FAILED in that
          // case, so the actual value here is a placeholder pending a fix.
          amount: v.amountValid ? v.amount : "0",
          // Prisma treats `undefined` in update data as "leave unchanged",
          // not "clear it" — explicit null is required to actually clear a
          // stale memo/errorMessage from a previous revision of this row.
          memo: v.memo ?? null,
          addressValid: v.addressValid,
          isDuplicate: v.isDuplicate,
          status: v.addressValid && v.amountValid ? ("PENDING" as const) : ("VALIDATION_FAILED" as const),
          errorMessage: v.errorMessage ?? null,
          // Stale after any edit — re-checked separately.
          accountExists: null,
          currentBalance: null,
          hasTrustline: null,
          trustlineLimitOk: null,
        };

        if (input.id && existingIds.has(input.id)) {
          await tx.recipient.update({ where: { id: input.id }, data });
        } else {
          await tx.recipient.create({ data: { ...data, batchId: batch.id } });
        }
      }

      await tx.batch.update({ where: { id: batch.id }, data: { status: "VALIDATED" } });

      return tx.batch.findUniqueOrThrow({
        where: { id: batch.id },
        include: { recipients: { orderBy: { rowIndex: "asc" } }, attempts: { include: { items: true } } },
      });
    });

    return NextResponse.json({ batch: updatedBatch });
  } catch (err) {
    // A second overlapping PUT for the same batch (a debounced save racing
    // a blur-triggered flush, say) can hit a row another in-flight
    // transaction already touched — surface it as a clean error instead of
    // an unhandled 500 with no body.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save recipients" },
      { status: 409 }
    );
  }
}
