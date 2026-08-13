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

