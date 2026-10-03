// E2E helper: sends a claimable balance distribution from the E2E wallet
// with a very short claim window (default 45 s), so the reclaim flow can
// be exercised in the browser without waiting 7 days. Testnet only.
//
//   npx tsx e2e/scripts/seed-expiring-claimables.ts [seconds]
//
// Prints the batch id on the last line.
import path from "node:path";
import { Keypair, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { execFileSync } from "node:child_process";

process.loadEnvFile(path.resolve(__dirname, "../../.env"));
process.loadEnvFile(path.resolve(__dirname, "../../.env.test"));

async function main() {
  const seconds = Number(process.argv[2] ?? 45);
  const { prisma } = await import("@/lib/db/prisma");
  const { prepareRun, authorizeRun } = await import("@/lib/distribution/engine");
  const { driveToEnd } = await import("@/lib/distribution/testSupport");
  const { getNetworkPassphrase } = await import("@/lib/stellar/client");

  // stellar-hd-wallet only loads cleanly as ESM, so derive in a child node.
  const secret = execFileSync("node", [path.resolve(__dirname, "wallet-secret.mjs")], { env: process.env }).toString();
  const sender = Keypair.fromSecret(secret);
  if (sender.publicKey() !== process.env.E2E_WALLET_PUBLIC_KEY) throw new Error("Mnemonic does not match E2E_WALLET_PUBLIC_KEY");

  const deadline = new Date(Date.now() + seconds * 1000);
  const batch = await prisma.batch.create({
    data: {
      network: "TESTNET",
      ownerPublicKey: sender.publicKey(),
      sourceAccount: sender.publicKey(),
      claimedAt: new Date(),
      kind: "CLAIMABLE_BALANCE",
      claimWindowDays: 7,
      claimExpiresAt: deadline,
      csvFileName: "expiring-claimables.csv",
      status: "READY",
      recipients: {
        create: Array.from({ length: 3 }, (_, i) => ({
          rowIndex: i + 1,
          destination: Keypair.random().publicKey(),
          amount: "2",
          addressValid: true,
          status: "READY" as const,
        })),
      },
    },
    include: { recipients: true },
  });
  const prepared = await prepareRun({
    batchId: batch.id,
    network: "TESTNET",
    sourceAccount: sender.publicKey(),
    idempotencyKey: `e2e-expiring-${batch.id}`,
    asset: null,
    ops: batch.recipients.map((r) => ({ kind: "createClaimableBalance" as const, recipientId: r.id, destination: r.destination, amount: "2" })),
    claimExpiresAt: deadline,
  });
  const setup = TransactionBuilder.fromXDR(prepared.setupXdr, getNetworkPassphrase("TESTNET")) as Transaction;
  setup.sign(sender);
  await authorizeRun(prepared.runId, setup.toXDR());
  const run = await driveToEnd(prepared.runId);
  if (run.status !== "COMPLETED") throw new Error(`seed run ended ${run.status}`);
  await prisma.batch.update({ where: { id: batch.id }, data: { status: "COMPLETED" } });
  console.log(JSON.stringify({ batchId: batch.id, deadline: deadline.toISOString() }));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
