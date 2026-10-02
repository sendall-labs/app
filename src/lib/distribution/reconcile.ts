import { StrKey, xdr } from "@stellar/stellar-sdk";
import type { ChannelTransaction } from "@/generated/prisma/client";
import type { Network } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer } from "@/lib/stellar/client";
import { describeResult, operationResults } from "./feeBump";

const TERMINAL = new Set(["SUCCESS", "FAILED", "REAUTHORIZATION_REQUIRED", "EXPIRED"]);

/** Horizon-style id ("00000000" + hash) of the balance an op created, if any. */
export function createdBalanceId(opResult: xdr.OperationResult | undefined): string | null {
  try {
    const tr = opResult?.tr();
    if (!tr || tr.switch().name !== "createClaimableBalance") return null;
    const res = tr.createClaimableBalanceResult();
    if (res.switch().name !== "createClaimableBalanceSuccess") return null;
    return res.balanceId().toXDR("hex");
  } catch {
    return null;
  }
}

function friendlyError(code: string | null | undefined): string {
  switch (code) {
    case "paymentNoDestination":
      return "Recipient account does not exist.";
    case "paymentNoTrust":
      return "Recipient has no trustline for this asset.";
    case "paymentLineFull":
      return "Recipient trustline limit is too low.";
    case "paymentUnderfunded":
    case "createAccountUnderfunded":
    case "createClaimableBalanceUnderfunded":
      return "Sender balance was too low.";
    case "createAccountAlreadyExist":
      return "Recipient account already exists.";
    case "CHANNEL_SEQUENCE_CHANGED":
      return "Transaction could not be sent safely. Authorize these rows again.";
    case "txTooLate":
    case "SETUP_EXPIRED":
      return "The approval window closed before this transaction was sent.";
    case "SETUP_FAILED":
      return "The authorization transaction failed, nothing was sent.";
    default:
      return code ? `Failed (${code}).` : "Failed.";
  }
}

/**
 * Copies a terminal chunk's outcome onto its items and recipients. A
 * Stellar transaction is atomic, so when one operation fails every row
 * in that chunk failed; rows whose own operation was fine are told the
 * failure came from elsewhere in the same transaction. Idempotent.
 */
export async function reconcileChunkById(chunkId: string) {
  const chunk = await prisma.channelTransaction.findUniqueOrThrow({ where: { id: chunkId }, include: { run: { select: { purpose: true } } } });
  await reconcileChunk(chunk, chunk.run.purpose);
}

export async function reconcileChunk(chunk: ChannelTransaction, purpose: "SEND" | "RECLAIM" | "REAUTHORIZE" | "CLEANUP" = "SEND") {
  if (!TERMINAL.has(chunk.status)) return;
  const items = await prisma.channelTransactionItem.findMany({ where: { transactionId: chunk.id }, orderBy: { operationIndex: "asc" } });
  const opResults = chunk.resultXdr ? operationResults(chunk.resultXdr) : [];
  const codes = chunk.resultXdr ? describeResult(xdr.TransactionResult.fromXDR(chunk.resultXdr, "base64")).perOperation : [];
  const failingCode = codes.find((c) => !c.success)?.code ?? chunk.errorCode;
  const txHash = chunk.stellarTxHash ?? chunk.transactionHash;
  const isReclaim = purpose === "RECLAIM";

  await prisma.$transaction(
    items.map((item) => {
      const own = codes[item.operationIndex];
      if (chunk.status === "SUCCESS") {
        const balanceId = createdBalanceId(opResults[item.operationIndex]);
        return prisma.channelTransactionItem.update({
          where: { id: item.id },
          data: {
            status: "SUCCESS",
            resultCode: own?.code ?? null,
            claimableBalanceId: balanceId,
            recipient: {
              update: isReclaim
                ? { claimStatus: "RECLAIMED", claimTxHash: txHash, claimedAt: chunk.confirmedAt ?? new Date() }
                : {
                    status: "SUCCESS",
                    errorMessage: null,
                    deliveryMethod: item.deliveryMethod,
                    ...(balanceId ? { claimableBalanceId: balanceId, claimStatus: "UNCLAIMED" as const } : {}),
                  },
            },
          },
        });
      }
      const ownFailed = own && !own.success;
      const message = ownFailed || !own ? friendlyError(own?.code ?? failingCode) : `Not sent: another row in the same transaction failed (${friendlyError(failingCode)})`;
      return prisma.channelTransactionItem.update({
        where: { id: item.id },
        data: {
          status: chunk.status,
          resultCode: own?.code ?? chunk.errorCode,
          ...(isReclaim ? {} : { recipient: { update: { status: "FAILED", errorMessage: message } } }),
        },
      });
    })
  );
}

/** Reconciles every terminal chunk of a run and rolls the batch status up. */
export async function reconcileRun(runId: string) {
  const run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId }, include: { transactions: true } });
  for (const chunk of run.transactions) await reconcileChunk(chunk, run.purpose);

  if (run.purpose === "RECLAIM" || run.purpose === "CLEANUP") return;
  const batchStatus =
    run.status === "COMPLETED"
      ? "COMPLETED"
      : run.status === "PARTIALLY_FAILED"
        ? "PARTIAL_FAILURE"
        : run.status === "FAILED" || run.status === "EXPIRED"
          ? "FAILED"
          : "SUBMITTING";
  await prisma.batch.update({ where: { id: run.batchId }, data: { status: batchStatus } });
}

export type SignerCheck = { leftoverHashes: string[]; sponsoredLeftovers: number };

/**
 * Reads the sender from Horizon and reports which of this run's
 * preAuthTx signers are still installed. Horizon can trail the ledger
 * by a moment, so a non-empty answer is re-read a few times first.
 */
export async function checkRunSigners(network: Network, sourceAccount: string, chunkHashes: string[], attempts = 4): Promise<SignerCheck> {
  const wanted = new Map(chunkHashes.map((h) => [StrKey.encodePreAuthTx(Buffer.from(h, "hex")), h]));
  let result: SignerCheck = { leftoverHashes: [], sponsoredLeftovers: 0 };
  for (let i = 0; i < attempts; i++) {
    const account = await getHorizonServer(network).loadAccount(sourceAccount);
    const left = account.signers.filter((s) => s.type === "preauth_tx" && wanted.has(s.key));
    result = {
      leftoverHashes: left.map((s) => wanted.get(s.key)!),
      sponsoredLeftovers: left.filter((s) => (s as { sponsor?: string }).sponsor).length,
    };
    if (result.leftoverHashes.length === 0) return result;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return result;
}
