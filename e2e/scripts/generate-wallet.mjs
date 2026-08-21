// Generates a fresh testnet wallet for Playwright e2e tests and funds it via
// Friendbot. Freighter's "import wallet" flow wants a mnemonic, not a raw
// secret key, so this derives account 0 via SEP-5 (stellar-hd-wallet) —
// Freighter derives the same account from the same mnemonic by default.
//
// Usage: node e2e/scripts/generate-wallet.mjs
// Paste the printed block into .env.test.
import StellarHDWalletPkg from "stellar-hd-wallet";

const StellarHDWallet = StellarHDWalletPkg.default ?? StellarHDWalletPkg;

const mnemonic = StellarHDWallet.generateMnemonic({ entropyBits: 128 });
const wallet = StellarHDWallet.fromMnemonic(mnemonic);
const publicKey = wallet.getPublicKey(0);

const res = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
const funded = res.ok;

console.log(`# Freighter import flow wants a mnemonic, not a raw secret.\nE2E_WALLET_MNEMONIC="${mnemonic}"\nE2E_WALLET_PASSWORD="TestPassword123!"\nE2E_WALLET_PUBLIC_KEY=${publicKey}\nE2E_BASE_URL=http://localhost:3000\n`);
console.error(funded ? `Funded ${publicKey} via Friendbot.` : `Friendbot funding failed for ${publicKey} — fund it manually.`);
