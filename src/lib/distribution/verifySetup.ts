import { FeeBumpTransaction, Keypair, TransactionBuilder, type Transaction, xdr } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";
import { getNetworkPassphrase } from "@/lib/stellar/client";
import { DistributionError } from "./errors";

export type ExpectedSetup = {
  network: Network;
  persistedXdr: string;
  persistedHash: string;
  sourceAccount: string;
  sponsorPublicKey: string;
  chunkHashes: string[];
  preAuthWeight: number;
  // The key the wallet signs with; the sender's master key by default.
  walletKey?: string;
};

function mismatch(reason: string): never {
  throw new DistributionError("SETUP_MISMATCH", `The signed setup does not match what was prepared (${reason}).`, { reason });
}

/**
 * Checks the shape of a setup transaction: sender-sourced, sponsorship
 * sandwich by the expected sponsor, exactly the expected preAuthTx
 * hashes and weight, nothing else. Applied to the persisted setup too,
 * so a bug in the builder can never reach the wallet unnoticed.
 */
export function assertSetupShape(tx: Transaction, expected: Omit<ExpectedSetup, "persistedXdr" | "persistedHash" | "network">) {
  const { sourceAccount, sponsorPublicKey, chunkHashes, preAuthWeight } = expected;
  if (tx.source !== sourceAccount) mismatch("transaction source");
  const ops = tx.operations;
  if (ops.length !== chunkHashes.length + 2) mismatch("operation count");

  const first = ops[0];
  if (first.type !== "beginSponsoringFutureReserves" || first.source !== sponsorPublicKey || first.sponsoredId !== sourceAccount) {
    mismatch("sponsorship start");
  }
  const last = ops[ops.length - 1];
  if (last.type !== "endSponsoringFutureReserves" || last.source !== sourceAccount) mismatch("sponsorship end");

  ops.slice(1, -1).forEach((op, i) => {
    if (op.type !== "setOptions") mismatch(`operation ${i + 1} type`);
    if (op.source !== sourceAccount) mismatch(`operation ${i + 1} source`);
    const signer = op.signer as { preAuthTx?: Buffer; weight?: number } | undefined;
    if (!signer?.preAuthTx || signer.preAuthTx.toString("hex") !== chunkHashes[i]) mismatch(`signer hash ${i + 1}`);
    if (signer.weight !== preAuthWeight) mismatch(`signer weight ${i + 1}`);
    if (
      op.masterWeight !== undefined ||
      op.lowThreshold !== undefined ||
      op.medThreshold !== undefined ||
      op.highThreshold !== undefined ||
      op.setFlags !== undefined ||
      op.clearFlags !== undefined ||
      op.homeDomain !== undefined ||
      op.inflationDest !== undefined
    ) {
      mismatch(`operation ${i + 1} changes more than a signer`);
    }
  });
}

/**
 * Validates the setup the browser sent back and returns the envelope to
 * submit. The transaction hash covers network, source, sequence, fee,
 * time bounds, memo and every operation, so requiring the persisted hash
 * proves only signatures changed. The returned envelope is rebuilt from
 * the persisted XDR with just the sponsor's and the wallet's verified
 * signatures; anything else the browser attached is dropped.
 */
export function verifySignedSetup(expected: ExpectedSetup, signedXdr: string, now = new Date()): string {
  const passphrase = getNetworkPassphrase(expected.network);
  let signed: Transaction | FeeBumpTransaction;
  try {
    signed = TransactionBuilder.fromXDR(signedXdr, passphrase);
  } catch {
    mismatch("unreadable XDR");
  }
  if (signed instanceof FeeBumpTransaction) mismatch("fee bump envelope");

  const persisted = TransactionBuilder.fromXDR(expected.persistedXdr, passphrase) as Transaction;
  const persistedHash = persisted.hash();
  if (persistedHash.toString("hex") !== expected.persistedHash) mismatch("persisted record");
  assertSetupShape(persisted, expected);

  const hash = signed.hash();
  if (!hash.equals(persistedHash)) mismatch("transaction contents");

  const maxTime = Number(persisted.timeBounds?.maxTime ?? 0);
  if (maxTime > 0 && Math.floor(now.getTime() / 1000) >= maxTime) {
    throw new DistributionError("SETUP_EXPIRED", "The approval window for this distribution has closed. Prepare it again.");
  }

  const pick = (publicKey: string): xdr.DecoratedSignature | undefined => {
    const kp = Keypair.fromPublicKey(publicKey);
    return signed.signatures.find((s) => s.hint().equals(kp.signatureHint()) && kp.verify(hash, s.signature()));
  };
  const walletSig = pick(expected.walletKey ?? expected.sourceAccount);
  if (!walletSig) mismatch("missing sender signature");
  const sponsorSig =
    pick(expected.sponsorPublicKey) ??
    persisted.signatures.find((s) => Keypair.fromPublicKey(expected.sponsorPublicKey).verify(hash, s.signature()));
  if (!sponsorSig) mismatch("missing sponsor signature");

  const final = TransactionBuilder.fromXDR(expected.persistedXdr, passphrase) as Transaction;
  final.signatures.splice(0, final.signatures.length, sponsorSig, walletSig);
  return final.toXDR();
}
