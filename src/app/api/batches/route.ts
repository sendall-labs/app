import { NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { getOrCreateAnonId } from "@/lib/auth/requireAnonSession";
import { resolveBatchAccess, batchAccessWhere } from "@/lib/auth/batchAccess";
import { prisma } from "@/lib/db/prisma";
import { parseRecipientsCsv } from "@/lib/csv/parse";
import { validateRecipients } from "@/lib/stellar/validation";

// Batches a single anonymous visitor can have unclaimed at once — a soft
// cap against drive-by draft spam, not a hard product limit.
const MAX_UNCLAIMED_ANON_BATCHES = 5;

const createBatchSchema = z.object({
  csvText: z.string().min(1),
  csvFileName: z.string().optional(),
  network: z.enum(["TESTNET", "PUBLIC"]),
  // Only known once a wallet is connected — a wallet-less draft has none yet.
  sourceAccount: z
    .string()
    .refine(
      (v) => StrKey.isValidEd25519PublicKey(v) || StrKey.isValidMed25519PublicKey(v),
      "Invalid source account"
    )
    .optional(),
  assetCode: z.string().optional(),
  assetIssuer: z.string().optional(),
});

export async function GET() {
  const access = await resolveBatchAccess();
  if (!access.publicKey && !access.anonId) return NextResponse.json({ batches: [] });

  const batches = await prisma.batch.findMany({
    where: batchAccessWhere(access),
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { recipients: true } } },
  });

  return NextResponse.json({ batches });
}

export async function POST(request: Request) {
  const publicKey = await getSessionPublicKey();
  const anonId = publicKey ? null : await getOrCreateAnonId();

  const parsed = createBatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { csvText, csvFileName, network, sourceAccount, assetCode, assetIssuer } = parsed.data;

  if (anonId) {
    const unclaimedCount = await prisma.batch.count({ where: { anonId, ownerPublicKey: null } });
    if (unclaimedCount >= MAX_UNCLAIMED_ANON_BATCHES) {
      return NextResponse.json(
        { error: "Too many draft batches — connect your wallet to claim or clear some first" },
        { status: 429 }
      );
    }
  }

  const { rows, errors: parseErrors, truncated } = parseRecipientsCsv(csvText);
  const validated = validateRecipients(rows);

  const batch = await prisma.batch.create({
    data: {
      ownerPublicKey: publicKey,
      anonId,
      network,
      // A wallet already connected at creation time owns the batch
      // outright — mirror /claim's invariant that ownerPublicKey and
      // sourceAccount always move together, or prepare() later 409s.
      sourceAccount: sourceAccount ?? publicKey ?? null,
      assetCode: assetCode || null,
      assetIssuer: assetIssuer || null,
      csvFileName,
      status: "VALIDATED",
      recipients: {
        create: validated.map((r) => ({
          rowIndex: r.rowIndex,
          destination: r.destination,
          // `amount` is a required Decimal column — a non-numeric value
          // can't be stored as-is; the row's already flagged
          // VALIDATION_FAILED below, so this is just a safe placeholder.
          amount: r.amountValid ? r.amount : "0",
          memo: r.memo,
          addressValid: r.addressValid,
          isDuplicate: r.isDuplicate,
          status: r.addressValid && r.amountValid ? "PENDING" : "VALIDATION_FAILED",
          errorMessage: r.errorMessage,
        })),
      },
    },
    include: { recipients: true },
  });

  return NextResponse.json({
    batch,
    parseErrors,
    truncated,
  });
}
