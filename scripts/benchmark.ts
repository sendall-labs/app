// Benchmark: Phase 1 sequential sender vs the channel engine on Testnet,
// on the same recipient lists (300, 500, 1,000 existing accounts),
// timed from the sender's signature to the last confirmation.
//
//   npx tsx scripts/benchmark.ts [sizes...]     e.g. npx tsx scripts/benchmark.ts 300 500 1000
//
// Writes docs/benchmark.md. Recipients are created once and cached in
// test-results/bench-recipients.json (gitignored). Testnet only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Keypair, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";

process.loadEnvFile(path.resolve(__dirname, "../.env"));

const CACHE = path.resolve(__dirname, "../test-results/bench-recipients.json");
const OUT = path.resolve(__dirname, "../docs/benchmark.md");
const AMOUNT = "0.0000001";

type Result = { engine: "sequential" | "channels"; size: number; ms: number; transactions: number; hashes: string[]; ledgers: number };

async function main() {
  const sizes = (process.argv.slice(2).map(Number).filter(Boolean) as number[]).length ? process.argv.slice(2).map(Number) : [300, 500, 1000];
  const { fundedAccount, submitAs, seedBatch, signLikeWallet, driveToEnd, TESTNET } = await import("@/lib/distribution/testSupport");
  const { prepareRun, authorizeRun } = await import("@/lib/distribution/engine");
  const { buildPaymentChunks } = await import("@/lib/stellar/txBuilder");
  const { submitAndPoll } = await import("@/lib/stellar/submit");
  const { getRpcServer, getNetworkPassphrase } = await import("@/lib/stellar/client");
  const { prisma } = await import("@/lib/db/prisma");
  const rpc = getRpcServer(TESTNET);

  // 1. Recipients: existing accounts, so both engines send plain payments.
  const max = Math.max(...sizes);
  let recipients: string[] = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : [];
  if (recipients.length < max) {
    console.log(`creating ${max - recipients.length} recipient accounts…`);
    const funder = await fundedAccount();
    while (recipients.length < max) {
      const batch = Array.from({ length: Math.min(100, max - recipients.length) }, () => Keypair.random().publicKey());
      await submitAs(funder, (b) => batch.forEach((d) => b.addOperation(Operation.createAccount({ destination: d, startingBalance: "1" }))));
      recipients = recipients.concat(batch);
      mkdirSync(path.dirname(CACHE), { recursive: true });
      writeFileSync(CACHE, JSON.stringify(recipients));
    }
  }

  async function ledgerOf(hash: string) {
    const r = await rpc.getTransaction(hash);
    return "ledger" in r ? (r.ledger as number) : 0;
  }

  // 2a. Phase 1: one signed master tx installs preAuth signers, then each
  // chunk is submitted and awaited in sequence, as the old batch page did.
  async function runSequential(size: number): Promise<Result> {
    const sender = await fundedAccount();
    const list = recipients.slice(0, size);
    const account = await rpc.getAccount(sender.publicKey());
    const chunks = buildPaymentChunks({
      network: TESTNET,
      sourceAccount: account,
      asset: null,
      recipients: list.map((d, i) => ({ recipientId: String(i), destination: d, amount: AMOUNT, needsCreateAccount: false })),
    });
    const start = Date.now();
    const hashes: string[] = [];
    for (const chunk of chunks) {
      const tx = TransactionBuilder.fromXDR(chunk.xdr, getNetworkPassphrase(TESTNET)) as Transaction;
      if (chunk.requiresSignature) tx.sign(sender);
      const res = await submitAndPoll(TESTNET, tx.toXDR());
      if (res.status !== "SUCCESS") throw new Error(`sequential chunk ${chunk.chunkIndex} ${res.status}`);
      hashes.push(res.hash);
    }
    const ms = Date.now() - start;
    const ledgers = new Set(await Promise.all(hashes.map(ledgerOf))).size;
    return { engine: "sequential", size, ms, transactions: hashes.length, hashes, ledgers };
  }

  // 2b. Channel engine: one setup signature, chunks in parallel.
  async function runChannels(size: number): Promise<Result> {
    const sender = await fundedAccount();
    const batch = await seedBatch(sender.publicKey(), recipients.slice(0, size), "PAYMENT", AMOUNT, { accountExists: true });
    try {
      const prepared = await prepareRun({
        batchId: batch.id,
        network: TESTNET,
        sourceAccount: sender.publicKey(),
        idempotencyKey: `bench-${batch.id}`,
        asset: null,
        ops: batch.recipients.map((r) => ({ kind: "payment" as const, recipientId: r.id, destination: r.destination, amount: AMOUNT })),
      });
      await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, sender));
      const run = await driveToEnd(prepared.runId, 40);
      if (run.status !== "COMPLETED") throw new Error(`channels run ${run.status}`);
      const txs = await prisma.channelTransaction.findMany({ where: { runId: run.id }, orderBy: { chunkIndex: "asc" } });
      const hashes = [run.setupTxHash!, ...txs.map((t) => t.stellarTxHash ?? t.transactionHash)];
      const ledgers = new Set(await Promise.all(hashes.map(ledgerOf))).size;
      return { engine: "channels", size, ms: run.completedAt!.getTime() - run.signedAt!.getTime(), transactions: hashes.length, hashes, ledgers };
    } finally {
      await prisma.batch.delete({ where: { id: batch.id } });
    }
  }

  const results: Result[] = [];
  for (const size of sizes) {
    for (const run of [runSequential, runChannels]) {
      const r = await run(size);
      console.log(`${r.engine.padEnd(10)} ${String(size).padStart(5)} recipients: ${(r.ms / 1000).toFixed(1)} s, ${r.transactions} txs over ${r.ledgers} ledgers`);
      results.push(r);
    }
  }

  // 3. Report.
  const testnetCap = 200;
  const link = (h: string) => `[\`${h.slice(0, 10)}…\`](https://stellar.expert/explorer/testnet/tx/${h})`;
  const rows = sizes.map((size) => {
    const s = results.find((r) => r.size === size && r.engine === "sequential")!;
    const c = results.find((r) => r.size === size && r.engine === "channels")!;
    return `| ${size.toLocaleString("en-US")} | ${(s.ms / 1000).toFixed(1)} s (${s.transactions} txs, ${s.ledgers} ledgers) | ${(c.ms / 1000).toFixed(1)} s (${c.transactions} txs, ${c.ledgers} ledgers) | ${(s.ms / c.ms).toFixed(2)}x |`;
  });
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const md = `# Benchmark: sequential vs channel accounts

Run ${when} on **Stellar Testnet** with \`npx tsx scripts/benchmark.ts\`. Same recipient lists for both engines: existing accounts, ${AMOUNT} XLM each, so every operation is a plain payment. Time is measured from the sender's signature to the last confirmation.

- **Sequential**: the Phase 1 sender. One signed transaction installs a preAuthTx signer per chunk, then the chunks are submitted from the sender's account one after another, each waiting for its ledger.
- **Channels**: the channel engine. One signed, sponsored setup transaction, then each chunk is sent from its own channel account, fee-bumped by Sendall, with as many in flight as the network's ledgers can hold.

| Recipients | Sequential | Channels | Speedup |
|---|---|---|---|
${rows.join("\n")}

## Reading the numbers

Testnet closes a ledger about every 5 seconds and accepts at most ${testnetCap} operations per ledger, shared with everyone else's traffic. In practice one 100-operation chunk lands per ledger, whichever engine sends it. The channel engine therefore cannot fit more chunks into a Testnet ledger than the sequential sender does. On Testnet it shows the mechanism (independent channels, one signature, no sender sequence bottleneck), not the speedup.

Mainnet ledgers take 1,000 operations. There the sequential sender is still limited to one chunk per ledger (each chunk waits for the previous one from the same account), while channel transactions can share a ledger. The SOW's "about twice as fast" target is a Mainnet measurement. The plan for it is in the Mainnet runbook (developer-docs, section 5).

## Transactions

${sizes
  .map((size) =>
    results
      .filter((r) => r.size === size)
      .map((r) => `**${r.engine}, ${size}**: ${r.hashes.map(link).join(", ")}`)
      .join("\n\n")
  )
  .join("\n\n")}
`;
  writeFileSync(OUT, md);
  console.log("wrote", OUT);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
