// Runs the full claimable balance lifecycle on Testnet and writes the
// transaction hashes to docs/evidence-testnet.md (section between the
// CLAIMABLE markers, replaced on each run).
//
//   npx tsx scripts/evidence-claimable.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

process.loadEnvFile(path.resolve(__dirname, "../.env"));

const FILE = path.resolve(__dirname, "../docs/evidence-testnet.md");
const START = "<!-- CLAIMABLE:START -->";
const END = "<!-- CLAIMABLE:END -->";
const tx = (h: string) => `[\`${h.slice(0, 12)}…\`](https://stellar.expert/explorer/testnet/tx/${h})`;
const acct = (a: string) => `[\`${a.slice(0, 6)}…${a.slice(-4)}\`](https://stellar.expert/explorer/testnet/account/${a})`;

async function main() {
  const { runClaimableLifecycle } = await import("@/lib/distribution/scenarios/claimableLifecycle");
  const { prisma } = await import("@/lib/db/prisma");
  const r = await runClaimableLifecycle(60);
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const section = `${START}
## Claimable balances: create, claim, reclaim

Run ${when}. Asset \`${r.asset.code}\` issued by ${acct(r.asset.issuer)}, sent by ${acct(r.sender)} to three recipients who did not hold it, with a 60-second claim window (the app offers 7/30/90 days; the window is shortened here only to show the reclaim).

| Step | Transaction |
|---|---|
| Authorization (the sender's single signature, fee-bumped by Sendall) | ${tx(r.send.setupTx)} |
| Claimable balances created (channel transaction) | ${r.send.chunkTxs.map(tx).join(", ")} |
| Recipient A claims, trustline added in the same transaction | ${tx(r.claimTx)} |
| Reclaim authorization (one signature) | ${tx(r.reclaim.setupTx)} |
| B and C reclaimed after the window closed | ${r.reclaim.chunkTxs.map(tx).join(", ")} |

| Recipient | Account | Balance id | Outcome |
|---|---|---|---|
${r.recipients.map((x) => `| ${x.label} | ${acct(x.address)} | \`${x.balanceId.slice(0, 14)}…\` | ${x.outcome}${x.claimTx ? ` (${tx(x.claimTx)})` : ""} |`).join("\n")}

Reserve locked while the balances were open: ${r.reserveLockedXlm} XLM (3 balances x 2 claimants x 0.5 XLM), all released after the claim and the reclaim.
${END}`;

  const header = "# Testnet evidence\n\nTransaction hashes from runs on Stellar Testnet. Testnet is reset from time to time, so the screenshots in `docs/screenshots/sow2/` are kept as well.\n";
  const current = existsSync(FILE) ? readFileSync(FILE, "utf8") : header;
  const next = current.includes(START)
    ? current.replace(new RegExp(`${START}[\\s\\S]*${END}`), section)
    : `${current.trimEnd()}\n\n${section}\n`;
  writeFileSync(FILE, next);
  await prisma.$disconnect();
  console.log("wrote", FILE);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
