import { NextResponse } from "next/server";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { batchId } = await params;
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, ownerPublicKey: publicKey },
    select: {
      id: true,
      status: true,
      recipients: { select: { status: true } },
    },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const counts: Record<string, number> = {};
  for (const r of batch.recipients) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }

  return NextResponse.json({ status: batch.status, counts, total: batch.recipients.length });
}
