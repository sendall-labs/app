import { NextResponse, after } from "next/server";
import { advanceRun } from "@/lib/distribution/engine";
import { loadRunView } from "@/lib/distribution/batchRuns";
import { errorResponse, findAccessibleRun } from "@/lib/distribution/http";

const IN_FLIGHT = new Set(["SETUP_SUBMITTED", "SETUP_CONFIRMED", "PAYMENTS_SUBMITTING", "AWAITING_USER_SIGNATURE"]);

export const maxDuration = 120;

/**
 * Run status for the live send panel. Each poll also nudges the engine
 * forward after the response is sent; the run's lease keeps that to one
 * worker, so polling from several tabs is harmless and a server restart
 * resumes on the next poll.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await findAccessibleRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  try {
    if (IN_FLIGHT.has(run.status)) after(() => advanceRun(runId).catch((err) => console.error("advanceRun", runId, err)));
    return NextResponse.json({ run: await loadRunView(runId) });
  } catch (err) {
    return errorResponse(err);
  }
}
