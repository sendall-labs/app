import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { prepareBatchRun, rowsNeedingReauthorization } from "@/lib/distribution/batchRuns";
import { isTerminalRun } from "@/lib/distribution/engine";
import { errorResponse, findAccessibleRun } from "@/lib/distribution/http";
import { resolveBatchAccess } from "@/lib/auth/batchAccess";

const bodySchema = z.object({ idempotencyKey: z.string().min(8).max(100) });

/**
 * Starts a new authorization for the rows a finished run could not
 * deliver. The old transactions are never rebuilt: these rows get fresh
 * transactions and a fresh setup for the wallet to sign.
 */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { publicKey } = await resolveBatchAccess();
  if (!publicKey) return NextResponse.json({ error: "Connect your wallet first" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "idempotencyKey is required" }, { status: 400 });

  const { runId } = await params;
  const run = await findAccessibleRun(runId);
  if (!run || run.sourceAccount !== publicKey) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!isTerminalRun(run.status)) return NextResponse.json({ error: "The run is still in progress" }, { status: 409 });

  try {
    const rowIds = await rowsNeedingReauthorization(runId);
    const rows = await prisma.recipient.findMany({ where: { id: { in: rowIds }, status: "FAILED" }, select: { id: true } });
    if (rows.length === 0) return NextResponse.json({ error: "Nothing to send again" }, { status: 409 });
    await prisma.recipient.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "READY", errorMessage: null } });

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: run.batchId }, include: { recipients: true } });
    // Only the rows from this run go out again, not other READY rows.
    const scoped = { ...batch, recipients: batch.recipients.filter((r) => rows.some((x) => x.id === r.id)) };
    const prepared = await prepareBatchRun({ batch: scoped, idempotencyKey: parsed.data.idempotencyKey, purpose: "REAUTHORIZE", parentRunId: runId });
    return NextResponse.json({ runId: prepared.runId, setupXdr: prepared.setupXdr, transactionCount: prepared.transactionCount });
  } catch (err) {
    return errorResponse(err);
  }
}
