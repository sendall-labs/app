import { rpc, xdr } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";
import { getRpcServer } from "./client";

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15;

export type SubmitResult = {
  hash: string;
  status: "SUCCESS" | "FAILED" | "TIMEOUT";
  resultXdr?: string;
  perOperation: { operationIndex: number; success: boolean; code: string }[];
};

/** Extracts each operation's result code (e.g. "paymentNoTrust") from a decoded TransactionResult. */
function decodePerOperationResults(
  result: xdr.TransactionResult
): { operationIndex: number; success: boolean; code: string }[] {
  const results = result.result().results?.() ?? [];
  return results.map((opResult, operationIndex) => {
    const tr = opResult.tr();
    const kind = tr.switch().name;
    const inner =
      // @ts-expect-error -- dynamic access across each xdr union's per-type result getter
      typeof tr[`${kind}Result`] === "function" ? tr[`${kind}Result`]() : null;
    const code: string = inner ? inner.switch().name : kind;
    const success = /success$/i.test(code);
    return { operationIndex, success, code };
  });
}

/**
 * Submits a signed transaction envelope and polls until it reaches a
 * terminal state. Runs backend-side (not client-only) so a batch keeps
 * an audit trail even if the browser tab closes mid-submission.
 */
export async function submitAndPoll(
  network: Network,
  signedXdr: string
): Promise<SubmitResult> {
  const server = getRpcServer(network);
  const { TransactionBuilder } = await import("@stellar/stellar-sdk");
  const { getNetworkPassphrase } = await import("./client");
  const tx = TransactionBuilder.fromXDR(signedXdr, getNetworkPassphrase(network));

  const sendResult = await server.sendTransaction(tx);
  if (sendResult.status === "ERROR") {
    return {
      hash: sendResult.hash,
      status: "FAILED",
      perOperation: sendResult.errorResult
        ? decodePerOperationResults(sendResult.errorResult)
        : [],
    };
  }

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const getResult = await server.getTransaction(sendResult.hash);

    if (getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND) continue;

    const perOperation = getResult.resultXdr
      ? decodePerOperationResults(getResult.resultXdr)
      : [];

    return {
      hash: sendResult.hash,
      status: getResult.status === rpc.Api.GetTransactionStatus.SUCCESS ? "SUCCESS" : "FAILED",
      resultXdr: getResult.resultXdr?.toXDR("base64"),
      perOperation,
    };
  }

  return { hash: sendResult.hash, status: "TIMEOUT", perOperation: [] };
}
