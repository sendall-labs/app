// Writes a report of every account and transaction a demo recording used,
// with Stellar Expert links, read from the local database.
//
//   npx tsx e2e/scripts/demo-report.ts <out.md> <label>=<batchId> ...
import { writeFileSync } from "node:fs";
import path from "node:path";

process.loadEnvFile(path.resolve(__dirname, "../../.env"));

const explorer = (network: string) => `https://stellar.expert/explorer/${network === "PUBLIC" ? "public" : "testnet"}`;

async function main() {
  const [out, ...pairs] = process.argv.slice(2);
  if (!out || pairs.length === 0) throw new Error("usage: demo-report.ts <out.md> <label>=<batchId> ...");
  const { prisma } = await import("@/lib/db/prisma");

  const lines: string[] = [];
  const accounts = new Map<string, Set<string>>(); // address -> roles
  const role = (address: string | null | undefined, what: string) => {
    if (!address) return;
    if (!accounts.has(address)) accounts.set(address, new Set());
    accounts.get(address)!.add(what);
  };
  let network = "TESTNET";
  let txCount = 0;

  for (const pair of pairs) {
    const [label, batchId] = pair.split("=");
    const batch = await prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
      include: {
        recipients: { orderBy: { rowIndex: "asc" } },
        runs: { orderBy: { createdAt: "asc" }, include: { transactions: { orderBy: { chunkIndex: "asc" } } } },
      },
    });
    network = batch.network;
    const ex = explorer(batch.network);
    const acct = (a: string) => `[\`${a}\`](${ex}/account/${a})`;
    const tx = (h: string) => `[\`${h.slice(0, 12)}…\`](${ex}/tx/${h})`;
    const sender = batch.sourceAccount ?? batch.ownerPublicKey;
    role(sender, `sender (${label})`);

    lines.push(`## ${label}`, "");
    lines.push(`- Batch: \`${batch.id}\``);
    lines.push(`- Kind: ${batch.kind === "CLAIMABLE_BALANCE" ? "claimable balance" : "payment"}, network: ${batch.network}, asset: ${batch.assetCode ?? "XLM"}`);
    if (sender) lines.push(`- Sender: ${acct(sender)}`);
    if (batch.claimExpiresAt) lines.push(`- Claim deadline: ${batch.claimExpiresAt.toISOString()}`);
    lines.push("");

    for (const run of batch.runs) {
      role(run.sponsorAccount, "Sendall sponsor (fees, reserves)");
      lines.push(`### ${run.purpose.toLowerCase()} run: ${run.status.toLowerCase().replace(/_/g, " ")}`, "");
      lines.push(`- Sponsor: ${acct(run.sponsorAccount)}`);
      if (run.setupTxHash) {
        lines.push(`- Authorization (the one wallet signature): ${tx(run.setupTxHash)}`);
        txCount++;
      }
      if (run.transactions.length) {
        lines.push("", "| # | Channel account | Transaction | Status |", "|---|---|---|---|");
        for (const t of run.transactions) {
          role(t.channelPublicKey, "Sendall channel account");
          const hash = t.stellarTxHash ?? t.transactionHash;
          if (t.stellarTxHash) txCount++;
          lines.push(`| ${t.chunkIndex + 1} | ${acct(t.channelPublicKey)} | ${t.stellarTxHash ? tx(hash) : "not submitted"} | ${t.status.toLowerCase()} |`);
        }
      }
      lines.push("");
    }

    lines.push(`### Recipients (${batch.recipients.length})`, "");
    const claimable = batch.kind === "CLAIMABLE_BALANCE";
    lines.push(
      claimable ? "| # | Address | Amount | Status | Claim | Claim tx |" : "| # | Address | Amount | Status |",
      claimable ? "|---|---|---|---|---|---|" : "|---|---|---|---|"
    );
    for (const r of batch.recipients) {
      role(r.destination, `recipient (${label})`);
      const base = `| ${r.rowIndex + 1} | ${acct(r.destination)} | ${r.amount.toString()} | ${r.status.toLowerCase()} |`;
      if (!claimable) lines.push(base);
      else {
        if (r.claimTxHash) txCount++;
        lines.push(`${base} ${r.claimStatus?.toLowerCase() ?? "-"} | ${r.claimTxHash ? tx(r.claimTxHash) : "-"} |`);
      }
    }
    lines.push("");
  }

  const ex = explorer(network);
  const header = [
    "# Demo report: accounts and transactions",
    "",
    `Generated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC from the local database after the demo recording. Network: ${network}. ${accounts.size} accounts, ${txCount} transactions.`,
    "",
    "## Accounts",
    "",
    "| Address | Role |",
    "|---|---|",
    ...[...accounts].map(([a, roles]) => `| [\`${a}\`](${ex}/account/${a}) | ${[...roles].join(", ")} |`),
    "",
  ];
  writeFileSync(out, [...header, ...lines].join("\n"));
  console.log(out);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
