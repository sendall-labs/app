// Operator script: top up the channel pool on a network from that
// network's sponsor account.
//
//   npx tsx scripts/provision-channels.ts TESTNET 20
//   npx tsx scripts/provision-channels.ts PUBLIC 20 --yes   (spends real XLM)
//
// Each channel is created with 2 XLM from the sponsor, which stays with
// the channel. Mainnet requires --yes.
import path from "node:path";

process.loadEnvFile(path.resolve(__dirname, "../.env"));

async function main() {
  const [network, sizeArg, flag] = process.argv.slice(2);
  if (network !== "TESTNET" && network !== "PUBLIC") throw new Error("usage: provision-channels.ts <TESTNET|PUBLIC> <pool size> [--yes]");
  const size = Number(sizeArg ?? 20);
  if (!Number.isInteger(size) || size < 1 || size > 200) throw new Error("pool size must be 1-200");

  const { serviceStatus } = await import("@/lib/distribution/serviceStatus");
  const { ensurePool, CHANNEL_STARTING_BALANCE } = await import("@/lib/distribution/channelPool");
  const { prisma } = await import("@/lib/db/prisma");

  const before = await serviceStatus(network);
  const missing = Math.max(0, size - before.channelsTotal);
  console.log(`${network}: ${before.channelsTotal} channels, target ${size}, creating ${missing} (${missing * Number(CHANNEL_STARTING_BALANCE)} XLM)`);
  console.log(`sponsor configured: ${before.sponsorConfigured}, spendable: ${before.sponsorSpendableXlm ?? "n/a"} XLM`);
  if (network === "PUBLIC" && flag !== "--yes") {
    console.log("Mainnet spends real XLM. Re-run with --yes to proceed.");
    return;
  }
  if (missing > 0) await ensurePool(network, size);
  const after = await serviceStatus(network);
  console.log(`done: ${after.channelsTotal} channels (${after.channelsAvailable} available); ready=${after.ready} ${after.reasons.join(" ")}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
