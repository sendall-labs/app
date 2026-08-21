import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db/prisma";
import { validateRecipients } from "@/lib/stellar/validation";

const bodySchema = z.object({ network: z.enum(["TESTNET", "PUBLIC"]) });

/**
 * Creates a new batch pre-filled from an address list's entries — the
 * wallet is already connected to own the list, so the batch is created
 * directly owned (not the anonymous-draft path new/page.tsx uses).
 * Amounts start at a placeholder "1" the user reviews/edits from the
 * batch's Prepare tab, same as any freshly-typed recipient row.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { listId } = await params;
  const list = await prisma.addressList.findFirst({
    where: { id: listId, ownerPublicKey: publicKey },
    include: { entries: { orderBy: { rowIndex: "asc" } } },
  });
  if (!list) return NextResponse.json({ error: "Address list not found" }, { status: 404 });
  if (list.entries.length === 0) {
    return NextResponse.json({ error: "This address list has no entries" }, { status: 400 });
  }

  const validated = validateRecipients(
    list.entries.map((e, i) => ({ rowIndex: i + 1, destination: e.address, amount: "1" }))
  );

  const batch = await prisma.batch.create({
    data: {
      ownerPublicKey: publicKey,
      sourceAccount: publicKey,
      network: parsed.data.network,
      status: "VALIDATED",
      csvFileName: list.name,
      recipients: {
        create: validated.map((r) => ({
          rowIndex: r.rowIndex,
          destination: r.destination,
          amount: r.amountValid ? r.amount : "0",
          addressValid: r.addressValid,
          isDuplicate: r.isDuplicate,
          status: r.addressValid && r.amountValid ? "PENDING" : "VALIDATION_FAILED",
          errorMessage: r.errorMessage,
        })),
      },
    },
  });

  return NextResponse.json({ batch });
}
