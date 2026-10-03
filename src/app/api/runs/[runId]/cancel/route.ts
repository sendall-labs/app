import { NextResponse } from "next/server";
import { cancelRun } from "@/lib/distribution/engine";
import { errorResponse, findAccessibleRun } from "@/lib/distribution/http";

/** Backs out of a prepared run at the review step, before any signature. */
export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await findAccessibleRun(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  try {
    const cancelled = await cancelRun(runId);
    return NextResponse.json({ status: cancelled.status });
  } catch (err) {
    return errorResponse(err);
  }
}
