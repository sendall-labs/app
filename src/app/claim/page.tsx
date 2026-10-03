import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";
import { ClaimClient } from "@/components/claim/ClaimClient";

export const metadata: Metadata = { title: "Claim your funds · Sendall" };

/**
 * Public page for recipients of a claimable balance distribution. No
 * Sendall account or session: the recipient connects a wallet, sees what
 * is waiting and claims it with their own signature.
 */
export default async function ClaimPage({ searchParams }: { searchParams: Promise<{ batch?: string; network?: string }> }) {
  const { batch: batchId, network: networkParam } = await searchParams;
  const batch = batchId
    ? await prisma.batch.findFirst({ where: { id: batchId, kind: "CLAIMABLE_BALANCE" }, select: { id: true, network: true } })
    : null;
  const network = batch?.network ?? (networkParam === "PUBLIC" ? "PUBLIC" : "TESTNET");
  return <ClaimClient network={network} batchId={batch?.id} />;
}
