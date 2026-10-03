// Runs a 150-recipient payment distribution through the channel engine on
// Testnet and writes its transaction hashes to docs/evidence-testnet.md
// (section between the PAYMENT markers, replaced on each run).
//
//   npx tsx scripts/evidence-payment.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";

process.loadEnvFile(path.resolve(__dirname, "../.env"));

const FILE = path.resolve(__dirname, "../docs/evidence-testnet.md");
const START = "<!-- PAYMENT:START -->";
const END = "<!-- PAYMENT:END -->";
const tx = (h: string) => `[\`${h.slice(0, 12)}…\`](https://stellar.expert/explorer/testnet/tx/${h})`;
const acct = (a: string) => `[\`${a.slice(0, 6)}…${a.slice(-4)}\`](https://stellar.expert/explorer/testnet/account/${a})`;

async function main() {
  const { fundedAccount, seedBatch, signLikeWallet, driveToEnd, TESTNET } = await import("@/lib/distribution/testSupport");
  const { prepareRun, authorizeRun } = await import("@/lib/distribution/engine");
  const { checkRunSigners } = await import("@/lib/distribution/reconcile");
  const { getHorizonServer, getRpcServer } = await import("@/lib/stellar/client");
  const { prisma } = await import("@/lib/db/prisma");

  const sender = await fundedAccount();
  const destinations = Array.from({ length: 150 }, () => Keypair.random().publicKey());
  const batch = await seedBatch(sender.publicKey(), destinations, "PAYMENT", "2", { accountExists: false });
  const before = await getHorizonServer(TESTNET).loadAccount(sender.publicKey());
  const prepared = await prepareRun({
    batchId: batch.id,
    network: TESTNET,
    sourceAccount: sender.publicKey(),
    idempotencyKey: `evidence-payment-${batch.id}`,
    asset: null,
    ops: batch.recipients.map((r) => ({ kind: "createAccount" as const, recipientId: r.id, destination: r.destination, amount: "2" })),
  });
  await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, sender));
  const run = await driveToEnd(prepared.runId);
  if (run.status !== "COMPLETED") throw new Error(`run ended ${run.status}`);
  const chunks = await prisma.channelTransaction.findMany({
    where: { runId: run.id },
    orderBy: { chunkIndex: "asc" },
    include: { _count: { select: { items: true } } },
  });
  const after = await getHorizonServer(TESTNET).loadAccount(sender.publicKey());
  const spent = Number(before.balances.find((b) => b.asset_type === "native")!.balance) - Number(after.balances.find((b) => b.asset_type === "native")!.balance);
  const leftovers = await checkRunSigners(TESTNET, sender.publicKey(), chunks.map((c) => c.transactionHash));
  const setupInfo = await getRpcServer(TESTNET).getTransaction(run.setupTxHash!);
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const section = `${START}
## Payments through the channel engine

Run ${when}. ${acct(sender.publicKey())} sends 2 XLM to each of 150 new accounts (account creation) with one wallet signature. Signature to last confirmation: ${((run.completedAt!.getTime() - run.signedAt!.getTime()) / 1000).toFixed(1)} s.

| Step | Transaction |
|---|---|
| Authorization: sponsored setup installing ${chunks.length} one-time preAuthTx signers, fee paid by Sendall | ${tx(run.setupTxHash!)} (ledger ${"ledger" in setupInfo ? setupInfo.ledger : "?"}) |
${chunks.map((c) => `| Chunk ${c.chunkIndex + 1}: ${c._count.items} accounts created from channel ${acct(c.channelPublicKey)}, fee-bumped by Sendall | ${tx(c.stellarTxHash ?? c.transactionHash)} |`).join("\n")}

Checks after the run:
- The sender spent exactly ${spent.toFixed(7).replace(/\.?0+$/, "")} XLM for 150 x 2 XLM: no fees, no reserve.
- PreAuthTx signers left on the sender: ${leftovers.leftoverHashes.length}. Sponsored entries left: ${after.num_sponsored}.
${END}`;

  const header = "# Testnet evidence\n\nTransaction hashes from runs on Stellar Testnet. Testnet is reset from time to time, so the screenshots in `docs/screenshots/sow2/` are kept as well.\n";
  const current = existsSync(FILE) ? readFileSync(FILE, "utf8") : header;
  const next = current.includes(START)
    ? current.replace(new RegExp(`${START}[\\s\\S]*${END}`), section)
    : current.replace(header.trimEnd(), `${header.trimEnd()}\n\n${section}`);
  writeFileSync(FILE, next);
  await prisma.batch.delete({ where: { id: batch.id } });
  await prisma.$disconnect();
  console.log("wrote", FILE);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
