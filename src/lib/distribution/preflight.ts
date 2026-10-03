import { BASE_FEE, type Asset } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";
import { checkRecipients } from "@/lib/stellar/balanceCheck";
import type { DistributionOp } from "./buildChunks";
import { chunkCount } from "./buildChunks";
import { DistributionError } from "./errors";
import { claimableBalanceReserve, fromStroops, getBaseReserveStroops, loadAccountFunds, toStroops } from "./reserve";

export type PreflightProblem = { code: string; message: string; recipientId?: string };

export type PreflightSummary = {
  baseReserve: string;
  // XLM the sender must have free: native amounts, new-account balances
  // and claimable balance reserves.
  senderNativeNeeded: string;
  senderAssetNeeded: string | null;
  claimableReserve: string;
  sponsorNeeded: string;
};

type Row = { recipientId: string; destination: string; amount: string; memo?: string | null };

/**
 * Last check before a setup is built: everything that would make an
 * authorized transaction fail on-chain, caught while nothing is signed.
 * Throws PREFLIGHT_FAILED (sender or rows) or SPONSOR_UNDERFUNDED with
 * every problem listed.
 */
export async function runPreflight(params: {
  network: Network;
  sourceAccount: string;
  sponsorAccount: string;
  asset: Asset | null;
  ops: DistributionOp[];
  rows: Row[];
  feePerOp?: string;
}): Promise<PreflightSummary> {
  const { network, sourceAccount, sponsorAccount, asset, ops, rows } = params;
  const problems: PreflightProblem[] = [];

  // One transaction carries one memo, so per-row memos cannot be honored
  // inside a shared chunk; sending without them could lose an exchange
  // deposit.
  for (const r of rows) {
    if (r.memo && r.memo.trim()) {
      problems.push({ code: "MEMO_UNSUPPORTED", recipientId: r.recipientId, message: "Rows with a memo cannot be sent in bulk. Remove the memo, or send this row from your wallet directly." });
    }
  }

  const baseReserve = await getBaseReserveStroops(network);
  const assetRef = asset && !asset.isNative() ? { code: asset.getCode(), issuer: asset.getIssuer()! } : null;
  const senderIsIssuer = !!assetRef && assetRef.issuer === sourceAccount;
  const funds = await loadAccountFunds(network, sourceAccount, baseReserve, senderIsIssuer ? null : assetRef);

  let nativeNeeded = BigInt(0);
  let assetNeeded = BigInt(0);
  let claimables = 0;
  for (const op of ops) {
    if (op.kind === "claimClaimableBalance") continue;
    const stroops = toStroops(op.amount);
    if (op.kind === "createClaimableBalance") claimables++;
    if (op.kind === "createAccount" || !assetRef) nativeNeeded += stroops;
    else assetNeeded += stroops;
  }
  const cbReserve = claimableBalanceReserve(claimables, baseReserve);
  nativeNeeded += cbReserve;

  if (funds.spendableNative < nativeNeeded) {
    problems.push({
      code: "SENDER_XLM_SHORT",
      message: `Your account needs ${fromStroops(nativeNeeded)} XLM free for this distribution${claimables ? ` (including ${fromStroops(cbReserve)} XLM locked by claimable balances until claimed)` : ""}, but only ${fromStroops(funds.spendableNative > BigInt(0) ? funds.spendableNative : BigInt(0))} XLM is available.`,
    });
  }
  if (assetRef && !senderIsIssuer) {
    if (funds.assetBalance === null) {
      problems.push({ code: "SENDER_NO_TRUSTLINE", message: `Your account does not hold ${assetRef.code}.` });
    } else if (!funds.assetAuthorized) {
      problems.push({ code: "SENDER_NOT_AUTHORIZED", message: `The ${assetRef.code} issuer has not authorized your account to send it.` });
    } else if (funds.assetBalance < assetNeeded) {
      problems.push({
        code: "SENDER_ASSET_SHORT",
        message: `This distribution sends ${fromStroops(assetNeeded)} ${assetRef.code}, but your account has ${fromStroops(funds.assetBalance)}.`,
      });
    }
  }

  // Payments and account creation need a ready destination right now;
  // claimable balances deliberately do not.
  const deliveries = ops.filter((op): op is Extract<DistributionOp, { kind: "payment" | "createAccount" }> => op.kind === "payment" || op.kind === "createAccount");
  if (deliveries.length > 0) {
    const checks = await checkRecipients(
      network,
      deliveries.map((op) => ({ destination: op.destination, amount: op.amount })),
      assetRef ? asset : null
    );
    for (const op of deliveries) {
      const result = checks.get(op.destination);
      if (!result) continue;
      if (op.kind === "createAccount" && result.accountExists) {
        problems.push({ code: "DESTINATION_CHANGED", recipientId: op.recipientId, message: "This account now exists. Run the checks again." });
      } else if (op.kind === "payment" && !result.ok) {
        problems.push({ code: "DESTINATION_NOT_READY", recipientId: op.recipientId, message: result.reason ?? "Recipient cannot receive this payment." });
      } else if (op.kind === "createAccount" && !result.ok) {
        problems.push({ code: "DESTINATION_NOT_READY", recipientId: op.recipientId, message: result.reason ?? "Recipient account cannot be created." });
      }
    }
  }

  if (problems.length > 0) {
    throw new DistributionError("PREFLIGHT_FAILED", problems.length === 1 ? problems[0].message : `${problems.length} problems must be fixed before sending.`, { problems });
  }

  // The sponsor pays one base reserve per temporary signer and every fee
  // (setup + chunks), with a 2x margin for fee movement.
  const chunks = chunkCount(ops.length);
  const feePerOp = BigInt(params.feePerOp ?? BASE_FEE);
  const feeOps = BigInt(ops.length + chunks + (chunks + 2) + 1);
  const sponsorNeeded = BigInt(chunks) * baseReserve + feeOps * feePerOp * BigInt(2);
  const sponsor = await loadAccountFunds(network, sponsorAccount, baseReserve, null);
  if (sponsor.spendableNative < sponsorNeeded) {
    throw new DistributionError("SPONSOR_UNDERFUNDED", "Sendall cannot cover the fees for this distribution right now. Try again later.", {
      needed: fromStroops(sponsorNeeded),
    });
  }

  return {
    baseReserve: fromStroops(baseReserve),
    senderNativeNeeded: fromStroops(nativeNeeded),
    senderAssetNeeded: assetRef ? fromStroops(assetNeeded) : null,
    claimableReserve: fromStroops(cbReserve),
    sponsorNeeded: fromStroops(sponsorNeeded),
  };
}
