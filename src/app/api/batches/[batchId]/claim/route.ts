import { NextResponse } from "next/server";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { peekAnonId } from "@/lib/auth/requireAnonSession";
import { prisma } from "@/lib/db/prisma";

/**
 * Attaches a connected wallet to a batch drafted anonymously. Called right
 * before the first signature is requested — not at batch creation — so a
 * visitor can build/edit a whole batch without ever connecting a wallet.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { batchId } = await params;
  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  // Already claimed by this same wallet — idempotent no-op.
  if (batch.ownerPublicKey === publicKey) return NextResponse.json({ batch });

  if (batch.ownerPublicKey) {
    return NextResponse.json({ error: "Batch already belongs to another wallet" }, { status: 403 });
  }

  const anonId = await peekAnonId();
  if (!anonId || batch.anonId !== anonId) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const claimed = await prisma.batch.update({
    where: { id: batch.id },
    data: { ownerPublicKey: publicKey, sourceAccount: publicKey, claimedAt: new Date() },
  });

  return NextResponse.json({ batch: claimed });
}
