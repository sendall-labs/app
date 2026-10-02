import { NextResponse } from "next/server";
import type { DistributionRun } from "@/generated/prisma/client";
import { resolveBatchAccess, batchAccessWhere } from "@/lib/auth/batchAccess";
import { prisma } from "@/lib/db/prisma";
import { DistributionError, type DistributionErrorCode } from "./errors";

const STATUS: Record<DistributionErrorCode, number> = {
  ACCOUNT_NOT_FOUND: 422,
  INSUFFICIENT_SIGNER_SLOTS: 422,
  UNSUPPORTED_MULTISIG: 422,
  PREFLIGHT_FAILED: 422,
  INSUFFICIENT_CHANNELS: 503,
  SPONSOR_NOT_CONFIGURED: 503,
  SPONSOR_UNDERFUNDED: 503,
  CHANNEL_SEQUENCE_CHANGED: 409,
  INVALID_STATE: 409,
  SETUP_MISMATCH: 400,
  SETUP_EXPIRED: 410,
};

export function errorResponse(err: unknown) {
  if (err instanceof DistributionError) {
    return NextResponse.json({ error: err.message, code: err.code, details: err.details ?? null }, { status: STATUS[err.code] });
  }
  console.error(err);
  return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
}

/** Loads a run only if the caller can access its batch. */
export async function findAccessibleRun(runId: string): Promise<DistributionRun | null> {
  const access = await resolveBatchAccess();
  return prisma.distributionRun.findFirst({ where: { id: runId, batch: batchAccessWhere(access) } });
}
