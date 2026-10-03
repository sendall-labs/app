import {
  Account,
  Asset,
  BASE_FEE,
  Claimant,
  MuxedAccount,
  Operation,
  StrKey,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { DeliveryMethod, Network } from "@/generated/prisma/enums";
import { getNetworkPassphrase } from "@/lib/stellar/client";
import { MAX_OPS_PER_TX } from "@/lib/stellar/txBuilder";

// One line of a distribution, already validated. Every resulting
// operation is sourced from the sender (U); the transaction itself is
// sourced from a channel.
export type DistributionOp =
  | { kind: "payment"; recipientId: string; destination: string; amount: string }
  | { kind: "createAccount"; recipientId: string; destination: string; amount: string }
  | { kind: "createClaimableBalance"; recipientId: string; destination: string; amount: string }
  | { kind: "claimClaimableBalance"; recipientId: string; balanceId: string };

export type ChunkChannel = { id: string; publicKey: string; currentSequence: string };

export type BuiltChunk = {
  chunkIndex: number;
  channelId: string;
  channelPublicKey: string;
  // The sequence number this transaction carries (channel's current + 1).
  channelSequence: string;
  xdr: string;
  hash: string;
  operationCount: number;
  items: { recipientId: string; operationIndex: number; deliveryMethod: DeliveryMethod }[];
};

export function chunkCount(opCount: number): number {
  return Math.ceil(opCount / MAX_OPS_PER_TX);
}

function baseAccountId(address: string): string {
  if (!StrKey.isValidMed25519PublicKey(address)) return address;
  return MuxedAccount.fromAddress(address, "0").baseAccount().accountId();
}

const DELIVERY: Record<DistributionOp["kind"], DeliveryMethod> = {
  payment: "PAYMENT",
  createAccount: "CREATE_ACCOUNT",
  createClaimableBalance: "CLAIMABLE_BALANCE",
  claimClaimableBalance: "CLAIMABLE_BALANCE",
};

function toOperation(op: DistributionOp, source: string, asset: Asset, claimExpiresAt?: Date) {
  switch (op.kind) {
    case "payment":
      return Operation.payment({ source, destination: op.destination, asset, amount: op.amount });
    case "createAccount":
      // createAccount only takes a G address; a muxed id is routing on top
      // of an account that would have to exist already.
      return Operation.createAccount({ source, destination: baseAccountId(op.destination), startingBalance: op.amount });
    case "createClaimableBalance": {
      if (!claimExpiresAt) throw new Error("claimExpiresAt is required for claimable balances.");
      const deadline = Math.floor(claimExpiresAt.getTime() / 1000).toString();
      const recipientCanClaim = Claimant.predicateBeforeAbsoluteTime(deadline);
      return Operation.createClaimableBalance({
        source,
        asset,
        amount: op.amount,
        claimants: [
          // Claimants must be plain accounts, never muxed ids.
          new Claimant(baseAccountId(op.destination), recipientCanClaim),
          // The sender can take it back only once the recipient's window
          // has closed.
          new Claimant(source, Claimant.predicateNot(recipientCanClaim)),
        ],
      });
    }
    case "claimClaimableBalance":
      return Operation.claimClaimableBalance({ source, balanceId: op.balanceId });
  }
}

/**
 * Builds one transaction per 100 operations, each sourced from its own
 * reserved channel at the channel's next sequence number. The returned
 * XDR and hash are final: the setup transaction pre-authorizes exactly
 * these hashes, so nothing here may be rebuilt after authorization.
 */
export function buildChunks(params: {
  network: Network;
  sourceAccount: string;
  asset: Asset | null;
  ops: DistributionOp[];
  channels: ChunkChannel[];
  maxTime: Date;
  claimExpiresAt?: Date;
  innerFeePerOp?: string;
}): BuiltChunk[] {
  const { network, sourceAccount, ops, channels, maxTime, claimExpiresAt } = params;
  if (ops.length === 0) throw new Error("A distribution needs at least one operation.");
  const needed = chunkCount(ops.length);
  if (channels.length !== needed) {
    throw new Error(`Expected ${needed} channels for ${ops.length} operations, got ${channels.length}.`);
  }
  if (new Set(channels.map((c) => c.publicKey)).size !== channels.length) {
    throw new Error("Each chunk needs a distinct channel.");
  }

  const asset = params.asset ?? Asset.native();
  const passphrase = getNetworkPassphrase(network);
  // The sponsor's fee bump pays the real fee; the inner fee only has to be
  // a valid bid and is never charged to the channel.
  const fee = params.innerFeePerOp ?? BASE_FEE;
  const maxTimeSeconds = Math.floor(maxTime.getTime() / 1000);

  return channels.map((channel, chunkIndex) => {
    const group = ops.slice(chunkIndex * MAX_OPS_PER_TX, (chunkIndex + 1) * MAX_OPS_PER_TX);
    // Account increments on build, so seed it with the current sequence.
    const builder = new TransactionBuilder(new Account(channel.publicKey, channel.currentSequence), {
      fee,
      networkPassphrase: passphrase,
      timebounds: { minTime: 0, maxTime: maxTimeSeconds },
    });
    group.forEach((op) => builder.addOperation(toOperation(op, sourceAccount, asset, claimExpiresAt)));
    const tx: Transaction = builder.build();

    return {
      chunkIndex,
      channelId: channel.id,
      channelPublicKey: channel.publicKey,
      channelSequence: tx.sequence,
      xdr: tx.toXDR(),
      hash: tx.hash().toString("hex"),
      operationCount: group.length,
      items: group.map((op, operationIndex) => ({
        recipientId: op.recipientId,
        operationIndex,
        deliveryMethod: DELIVERY[op.kind],
      })),
    };
  });
}
