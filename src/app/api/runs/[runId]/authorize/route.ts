import { NextResponse, after } from "next/server";
import { z } from "zod";
import { advanceRun, authorizeRun } from "@/lib/distribution/engine";
import { loadRunView } from "@/lib/distribution/batchRuns";
import { errorResponse, findAccessibleRun } from "@/lib/distribution/http";

const bodySchema = z.object({ signedXdr: z.string().min(1).max(200_000), confirmMainnet: z.boolean().optional() });

export const maxDuration = 120;

/** Receives the wallet-signed setup, verifies it and starts the run. */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "signedXdr is required" }, { status: 400 });

  const { runId } = await params;
  const run = await findAccessibleRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  // Real funds: never authorize without the explicit Mainnet confirmation.
  if (run.network === "PUBLIC" && parsed.data.confirmMainnet !== true) {
    return NextResponse.json({ error: "Confirm the Mainnet send first", code: "MAINNET_CONFIRMATION_REQUIRED" }, { status: 428 });
  }
  try {
    await authorizeRun(runId, parsed.data.signedXdr);
    after(() => advanceRun(runId).catch((err) => console.error("advanceRun", runId, err)));
    return NextResponse.json({ run: await loadRunView(runId) });
  } catch (err) {
    return errorResponse(err);
  }
}
