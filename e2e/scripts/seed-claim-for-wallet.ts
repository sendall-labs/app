// E2E helper: a fresh Testnet sender sends a 5 XLM claimable balance to
// the E2E wallet through the channel engine, so the public claim page can
// be exercised with Freighter as the recipient.
//
//   npx tsx e2e/scripts/seed-claim-for-wallet.ts
//
// Prints {"batchId": ...} on the last line.
import path from "node:path";
import { Keypair, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";

process.loadEnvFile(path.resolve(__dirname, "../../.env"));
process.loadEnvFile(path.resolve(__dirname, "../../.env.test"));

async function main() {
  const { prisma } = await import("@/lib/db/prisma");
  const { prepareRun, authorizeRun } = await import("@/lib/distribution/engine");
  const { driveToEnd, fundedAccount } = await import("@/lib/distribution/testSupport");
  const { getNetworkPassphrase } = await import("@/lib/stellar/client");

  const recipient = process.env.E2E_WALLET_PUBLIC_KEY!;
  const sender: Keypair = await fundedAccount();
  const batch = await prisma.batch.create({
    data: {
      network: "TESTNET",
      ownerPublicKey: sender.publicKey(),
      sourceAccount: sender.publicKey(),
      kind: "CLAIMABLE_BALANCE",
      claimWindowDays: 7,
      claimExpiresAt: new Date(Date.now() + 7 * 86_400_000),
      status: "READY",
      recipients: { create: [{ rowIndex: 1, destination: recipient, amount: "5", addressValid: true, status: "READY" }] },
    },
    include: { recipients: true },
  });
  const prepared = await prepareRun({
    batchId: batch.id,
    network: "TESTNET",
    sourceAccount: sender.publicKey(),
    idempotencyKey: `e2e-claim-${batch.id}`,
    asset: null,
    ops: [{ kind: "createClaimableBalance", recipientId: batch.recipients[0].id, destination: recipient, amount: "5" }],
    claimExpiresAt: batch.claimExpiresAt!,
  });
  const setup = TransactionBuilder.fromXDR(prepared.setupXdr, getNetworkPassphrase("TESTNET")) as Transaction;
  setup.sign(sender);
  await authorizeRun(prepared.runId, setup.toXDR());
  const run = await driveToEnd(prepared.runId);
  if (run.status !== "COMPLETED") throw new Error(`seed run ended ${run.status}`);
  console.log(JSON.stringify({ batchId: batch.id }));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
