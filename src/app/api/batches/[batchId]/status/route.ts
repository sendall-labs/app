import { NextResponse } from "next/server";
import { resolveBatchAccess, batchAccessWhere } from "@/lib/auth/batchAccess";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const access = await resolveBatchAccess();

  const { batchId } = await params;
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, ...batchAccessWhere(access) },
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
