import { NextResponse } from "next/server";
import { batchAccessWhere, resolveBatchAccess } from "@/lib/auth/batchAccess";
import { prisma } from "@/lib/db/prisma";
import { loadReceipt } from "@/lib/receipt/receiptData";
import { renderReceipt } from "@/lib/receipt/render";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Downloads the PDF receipt of a sent distribution. */
export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const access = await resolveBatchAccess();
  const { batchId } = await params;
  const batch = await prisma.batch.findFirst({ where: { id: batchId, ...batchAccessWhere(access) }, select: { id: true, status: true } });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  if (!["COMPLETED", "PARTIAL_FAILURE"].includes(batch.status)) {
    return NextResponse.json({ error: "A receipt is available once the distribution has been sent" }, { status: 409 });
  }
  const data = await loadReceipt(batch.id);
  const pdf = await renderReceipt(data);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="sendall-receipt-${data.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
