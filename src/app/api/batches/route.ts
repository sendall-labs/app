import { NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db/prisma";
import { parseRecipientsCsv } from "@/lib/csv/parse";
import { validateRecipients } from "@/lib/stellar/validation";

const createBatchSchema = z.object({
  csvText: z.string().min(1),
  csvFileName: z.string().optional(),
  network: z.enum(["TESTNET", "PUBLIC"]),
  sourceAccount: z.string().refine(
    (v) => StrKey.isValidEd25519PublicKey(v) || StrKey.isValidMed25519PublicKey(v),
    "Invalid source account"
  ),
  assetCode: z.string().optional(),
  assetIssuer: z.string().optional(),
});

export async function GET() {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const batches = await prisma.batch.findMany({
    where: { ownerPublicKey: publicKey },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { recipients: true } } },
  });

  return NextResponse.json({ batches });
}

export async function POST(request: Request) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const parsed = createBatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { csvText, csvFileName, network, sourceAccount, assetCode, assetIssuer } = parsed.data;

  const { rows, errors: parseErrors, truncated } = parseRecipientsCsv(csvText);
  const validated = validateRecipients(rows);

  const batch = await prisma.batch.create({
    data: {
      ownerPublicKey: publicKey,
      network,
      sourceAccount,
      assetCode: assetCode || null,
      assetIssuer: assetIssuer || null,
      csvFileName,
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
    include: { recipients: true },
  });

  return NextResponse.json({
    batch,
    parseErrors,
    truncated,
  });
}
