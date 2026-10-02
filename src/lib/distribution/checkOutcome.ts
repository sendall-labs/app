import type { BatchKind } from "@/generated/prisma/enums";
import type { CheckResult } from "@/lib/stellar/balanceCheck";

/**
 * Turns a live account check into a row status for the batch's type.
 * A payment needs the destination ready now. A claimable balance does
 * not: the recipient can create the account or add the trustline later
 * and claim then, so those become notes instead of failures.
 */
export function checkOutcome(kind: BatchKind, result: CheckResult | undefined, nativeAsset: boolean): { ok: boolean; message: string | null } {
  if (!result) return { ok: false, message: "Could not check this account." };
  if (kind === "PAYMENT") return { ok: result.ok, message: result.ok ? null : (result.reason ?? "Recipient cannot receive this payment.") };

  if (!result.accountExists) {
    return { ok: true, message: "No account yet. The recipient needs a funded account before claiming." };
  }
  if (!nativeAsset && !result.hasTrustline) {
    return { ok: true, message: "No trustline yet. The recipient adds it when claiming." };
  }
  if (!nativeAsset && result.reason === "Trustline is not authorized by the asset issuer") {
    return { ok: true, message: "Trustline not authorized yet. The issuer must authorize it before the recipient can claim." };
  }
  return { ok: true, message: null };
}
