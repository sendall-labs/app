// One-time Testnet setup for the channel engine.
//
//   npm run bootstrap:testnet
//
// - Generates SERVICE_KEY_ENCRYPTION_KEY if missing.
// - Generates the Testnet sponsor account (M) if missing and funds it
//   from friendbot. Tops it up from friendbot when it runs low.
// - Writes new values to .env (gitignored). Existing values are never
//   overwritten, so re-running is safe.
//
// Testnet only. Mainnet service accounts are funded by hand; see the
// Mainnet runbook.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Horizon, Keypair } from "@stellar/stellar-sdk";
import { generateEncryptionKey } from "@/lib/crypto/serviceKeys";
import { NETWORK_CONFIG } from "@/lib/stellar/client";

const ENV_PATH = path.resolve(__dirname, "../.env");
const MIN_SPONSOR_XLM = 5_000;

function readEnvFile(): string {
  return existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
}

function ensureEnv(name: string, make: () => string): string {
  const existing = process.env[name];
  if (existing) return existing;
  const value = make();
  const current = readEnvFile();
  appendFileSync(ENV_PATH, `${current.endsWith("\n") || current === "" ? "" : "\n"}${name}="${value}"\n`);
  process.env[name] = value;
  console.log(`+ wrote ${name} to .env`);
  return value;
}

async function friendbot(publicKey: string) {
  const res = await fetch(`${NETWORK_CONFIG.TESTNET.friendbot}?addr=${publicKey}`);
  if (!res.ok) throw new Error(`friendbot failed for ${publicKey}: ${res.status} ${await res.text()}`);
}

async function nativeBalance(horizon: Horizon.Server, publicKey: string): Promise<number | null> {
  try {
    const account = await horizon.loadAccount(publicKey);
    const native = account.balances.find((b) => b.asset_type === "native");
    return native ? Number(native.balance) : 0;
  } catch (err) {
    if ((err as { response?: { status?: number } }).response?.status === 404) return null;
    throw err;
  }
}

async function main() {
  if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);

  ensureEnv("SERVICE_KEY_ENCRYPTION_KEY", generateEncryptionKey);
  const sponsorSecret = ensureEnv("SPONSOR_SECRET_TESTNET", () => Keypair.random().secret());
  const sponsor = Keypair.fromSecret(sponsorSecret);

  const horizon = new Horizon.Server(NETWORK_CONFIG.TESTNET.horizonUrl);
  let balance = await nativeBalance(horizon, sponsor.publicKey());
  if (balance === null || balance < MIN_SPONSOR_XLM) {
    console.log(`funding sponsor ${sponsor.publicKey()} from friendbot`);
    await friendbot(sponsor.publicKey());
    balance = await nativeBalance(horizon, sponsor.publicKey());
  }
  console.log(`sponsor (M) ${sponsor.publicKey()} balance ${balance} XLM`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
