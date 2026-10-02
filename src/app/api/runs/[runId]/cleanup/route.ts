import { NextResponse } from "next/server";
import { prepareCleanup } from "@/lib/distribution/cleanup";
import { errorResponse, findAccessibleRun } from "@/lib/distribution/http";

/**
 * Prepares the removal of this run's leftover preAuthTx signers. The
 * wallet signs the returned XDR and sends it to the cleanup run's own
 * /authorize endpoint. Returns { clean: true } when nothing is left.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await findAccessibleRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  try {
    const plan = await prepareCleanup(runId);
    return NextResponse.json(plan ? { clean: false, ...plan } : { clean: true });
  } catch (err) {
    return errorResponse(err);
  }
}
