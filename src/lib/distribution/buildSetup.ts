import { Account, BASE_FEE, Keypair, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";
import { getNetworkPassphrase } from "@/lib/stellar/client";

export type BuiltSetup = {
  // Sponsor-signed, still missing the sender's signature.
  xdr: string;
  hash: string;
  sequence: string;
  maxTime: Date;
};

// Keeps the wallet window short; the chunks it authorizes get a longer
// window so they still have time to land after the setup confirms.
export const SETUP_TTL_SECONDS = 5 * 60;

/**
 * The one transaction the sender signs. Sourced from the sender, it
 * installs one preAuthTx signer per chunk hash while the sponsor (M)
 * sponsors their reserves, so the sender needs no extra XLM:
 *
 *   BeginSponsoringFutureReserves  source M, sponsored U
 *   SetOptions(add preAuthTx Hᵢ)    source U   × n
 *   EndSponsoringFutureReserves    source U
 *
 * The sponsor signs here, before the wallet sees it.
 */
export function buildSetup(params: {
  network: Network;
  sourceAccount: string;
  sourceSequence: string; // sender's current on-chain sequence
  sponsor: Keypair;
  chunkHashes: string[];
  preAuthWeight: number;
  maxTime: Date;
}): BuiltSetup {
  const { network, sourceAccount, sourceSequence, sponsor, chunkHashes, preAuthWeight, maxTime } = params;
  if (chunkHashes.length === 0) throw new Error("A setup needs at least one chunk hash.");
  if (new Set(chunkHashes).size !== chunkHashes.length) throw new Error("Duplicate chunk hash in setup.");
  if (!Number.isInteger(preAuthWeight) || preAuthWeight < 1 || preAuthWeight > 255) {
    throw new Error(`Invalid preAuthTx weight ${preAuthWeight}.`);
  }

  const builder = new TransactionBuilder(new Account(sourceAccount, sourceSequence), {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(network),
    timebounds: { minTime: 0, maxTime: Math.floor(maxTime.getTime() / 1000) },
  }).addOperation(Operation.beginSponsoringFutureReserves({ source: sponsor.publicKey(), sponsoredId: sourceAccount }));
  for (const hash of chunkHashes) {
    builder.addOperation(
      Operation.setOptions({
        source: sourceAccount,
        signer: { preAuthTx: Buffer.from(hash, "hex"), weight: preAuthWeight },
      })
    );
  }
  builder.addOperation(Operation.endSponsoringFutureReserves({ source: sourceAccount }));

  const tx: Transaction = builder.build();
  tx.sign(sponsor);
  return { xdr: tx.toXDR(), hash: tx.hash().toString("hex"), sequence: tx.sequence, maxTime };
}
