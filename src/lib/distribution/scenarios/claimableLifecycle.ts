// Full claimable balance lifecycle on Testnet, used by the integration
// test and by scripts/evidence-claimable.ts (which records the hashes):
//
//   issuer --(asset)--> sender --(claimable balances)--> 3 recipients
//   recipient A has no trustline: claims through the public claim flow
//   recipient B has no trustline and never claims
//   recipient C has no account at all
//   after the window closes the sender reclaims B and C with one signature
import { Asset, Keypair, Operation } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";
import { TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { getNetworkPassphrase } from "@/lib/stellar/client";
import { buildClaimTx, listClaimable, submitClaimTx } from "../claimPage";
import { authorizeRun, prepareRun } from "../engine";
import { prepareReclaim } from "../reclaim";
import { driveToEnd, fundedAccount, seedBatch, signLikeWallet, submitAs, TESTNET } from "../testSupport";

export type LifecycleResult = {
  batchId: string;
  asset: { code: string; issuer: string };
  sender: string;
  recipients: { label: string; address: string; balanceId: string; outcome: string; claimTx: string | null }[];
  send: { setupTx: string; chunkTxs: string[]; elapsedMs: number };
  claimTx: string;
  reclaim: { setupTx: string; chunkTxs: string[] };
  reserveLockedXlm: string;
};

async function runHashes(runId: string) {
  const run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId }, include: { transactions: { orderBy: { chunkIndex: "asc" } } } });
  return {
    setupTx: run.setupTxHash!,
    chunkTxs: run.transactions.map((t) => t.stellarTxHash ?? t.transactionHash),
    elapsedMs: run.completedAt && run.signedAt ? run.completedAt.getTime() - run.signedAt.getTime() : 0,
  };
}

export async function runClaimableLifecycle(windowSeconds = 60): Promise<LifecycleResult> {
  const issuer = await fundedAccount();
  const sender = await fundedAccount();
  const a = await fundedAccount();
  const b = await fundedAccount();
  const c = Keypair.random();
  const asset = new Asset("SNDL", issuer.publicKey());

  // The sender holds the asset like any treasury would.
  await submitAs(sender, (tx) => tx.addOperation(Operation.changeTrust({ asset })));
  await submitAs(issuer, (tx) => tx.addOperation(Operation.payment({ destination: sender.publicKey(), asset, amount: "1000" })));

  const deadline = new Date(Date.now() + windowSeconds * 1000);
  const batch = await seedBatch(sender.publicKey(), [a.publicKey(), b.publicKey(), c.publicKey()], "CLAIMABLE_BALANCE", "50", {
    assetCode: asset.getCode(),
    assetIssuer: issuer.publicKey(),
    claimExpiresAt: deadline,
  });
  const prepared = await prepareRun({
    batchId: batch.id,
    network: TESTNET,
    sourceAccount: sender.publicKey(),
    idempotencyKey: `lifecycle-${batch.id}`,
    asset,
    ops: batch.recipients.map((r) => ({ kind: "createClaimableBalance" as const, recipientId: r.id, destination: r.destination, amount: "50" })),
    claimExpiresAt: deadline,
  });
  await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, sender));
  const sent = await driveToEnd(prepared.runId);
  if (sent.status !== "COMPLETED") throw new Error(`send ended ${sent.status}`);
  const send = await runHashes(prepared.runId);

  // Recipient A claims through the public flow (trustline added in the same tx).
  const list = await listClaimable(TESTNET, a.publicKey(), batch.id);
  const mine = list.items.find((i) => i.fromBatch);
  if (!mine?.needsTrustline) throw new Error("expected A to need a trustline");
  const built = await buildClaimTx(TESTNET, a.publicKey(), [mine.id]);
  const claimTx = TransactionBuilder.fromXDR(built.xdr, getNetworkPassphrase(TESTNET)) as Transaction;
  claimTx.sign(a);
  const claimed = await submitClaimTx(TESTNET, claimTx.toXDR());
  if (claimed.status !== "SUCCESS") throw new Error("claim failed");

  // Window closes; the sender takes B and C back with one signature.
  await new Promise((r) => setTimeout(r, Math.max(0, deadline.getTime() - Date.now()) + 8_000));
  const reclaimPrep = await prepareReclaim(batch.id, sender.publicKey(), `lifecycle-reclaim-${batch.id}`);
  if (reclaimPrep.count !== 2) throw new Error(`expected 2 to reclaim, got ${reclaimPrep.count}`);
  await authorizeRun(reclaimPrep.runId, signLikeWallet(reclaimPrep.setupXdr, sender));
  const reclaimed = await driveToEnd(reclaimPrep.runId);
  if (reclaimed.status !== "COMPLETED") throw new Error(`reclaim ended ${reclaimed.status}`);
  const reclaim = await runHashes(reclaimPrep.runId);

  const rows = await prisma.recipient.findMany({ where: { batchId: batch.id }, orderBy: { rowIndex: "asc" } });
  const labels = ["A: no trustline, claims", "B: no trustline, never claims", "C: no account"];
  return {
    batchId: batch.id,
    asset: { code: asset.getCode(), issuer: issuer.publicKey() },
    sender: sender.publicKey(),
    recipients: rows.map((r, i) => ({ label: labels[i], address: r.destination, balanceId: r.claimableBalanceId!, outcome: r.claimStatus!, claimTx: r.claimTxHash })),
    send: { setupTx: send.setupTx, chunkTxs: send.chunkTxs, elapsedMs: send.elapsedMs },
    claimTx: claimed.hash,
    reclaim: { setupTx: reclaim.setupTx, chunkTxs: reclaim.chunkTxs },
    reserveLockedXlm: "3", // 3 balances x 2 claimants x 0.5 XLM
  };
}
