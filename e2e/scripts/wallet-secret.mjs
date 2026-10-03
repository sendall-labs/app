// Prints the E2E wallet's secret key (SEP-5 account 0 of E2E_WALLET_MNEMONIC)
// to stdout for local test scripts. Never write its output to a file.
import StellarHDWalletPkg from "stellar-hd-wallet";
const StellarHDWallet = StellarHDWalletPkg.default ?? StellarHDWalletPkg;
const mnemonic = process.env.E2E_WALLET_MNEMONIC;
if (!mnemonic) throw new Error("E2E_WALLET_MNEMONIC is not set");
process.stdout.write(StellarHDWallet.fromMnemonic(mnemonic).getSecret(0));
