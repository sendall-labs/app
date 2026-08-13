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

