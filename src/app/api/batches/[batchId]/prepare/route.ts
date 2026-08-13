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

