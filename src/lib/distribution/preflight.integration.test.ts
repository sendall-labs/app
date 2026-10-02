import { describe, expect, it } from "vitest";
import { Asset, Keypair } from "@stellar/stellar-sdk";
import { getSponsorKeypair } from "@/lib/stellar/serviceAccounts";
import type { DistributionOp } from "./buildChunks";
import { DistributionError } from "./errors";
import { runPreflight } from "./preflight";
import { fundedAccount, TESTNET } from "./testSupport";

const sponsorAccount = () => getSponsorKeypair(TESTNET).publicKey();

async function problemsOf(p: Promise<unknown>) {
  try {
    await p;
    return [];
  } catch (err) {
    if (!(err instanceof DistributionError)) throw err;
    return (err.details?.problems as { code: string; recipientId?: string }[]) ?? [err.code];
  }
}

describe.skipIf(!!process.env.CI)("preflight (Testnet)", () => {
  it("passes a fundable distribution and reports the claimable balance reserve", async () => {
    const user = await fundedAccount();
    const ops: DistributionOp[] = Array.from({ length: 5 }, (_, i) => ({
      kind: "createClaimableBalance",
      recipientId: `r${i}`,
      destination: Keypair.random().publicKey(),
      amount: "10",
    }));
    const summary = await runPreflight({
      network: TESTNET,
      sourceAccount: user.publicKey(),
      sponsorAccount: sponsorAccount(),
      asset: null,
      ops,
      rows: ops.map((o) => ({ recipientId: o.recipientId, destination: Keypair.random().publicKey(), amount: "10" })),
    });
    expect(summary.baseReserve).toBe("0.5");
    expect(summary.claimableReserve).toBe("5"); // 5 balances x 2 claimants x 0.5
    expect(summary.senderNativeNeeded).toBe("55");
  }, 60_000);

  it("lists every blocking problem before anything is signed", async () => {
    const user = await fundedAccount();
    const existing = await fundedAccount();
    const ops: DistributionOp[] = [
      { kind: "payment", recipientId: "missing", destination: Keypair.random().publicKey(), amount: "1" },
      { kind: "createAccount", recipientId: "exists", destination: existing.publicKey(), amount: "1" },
      { kind: "payment", recipientId: "memo", destination: existing.publicKey(), amount: "20000" },
    ];
    const problems = await problemsOf(
      runPreflight({
        network: TESTNET,
        sourceAccount: user.publicKey(),
        sponsorAccount: sponsorAccount(),
        asset: null,
        ops,
        rows: [
          { recipientId: "missing", destination: "", amount: "1" },
          { recipientId: "exists", destination: "", amount: "1" },
          { recipientId: "memo", destination: "", amount: "20000", memo: "123456" },
        ],
      })
    );
    const codes = problems.map((p) => (typeof p === "string" ? p : `${p.code}${p.recipientId ? `:${p.recipientId}` : ""}`)).sort();
    expect(codes).toEqual(["DESTINATION_CHANGED:exists", "MEMO_UNSUPPORTED:memo", "SENDER_XLM_SHORT"]);
  }, 60_000);

  it("refuses an asset the sender does not hold", async () => {
    const user = await fundedAccount();
    const usdc = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    const problems = await problemsOf(
      runPreflight({
        network: TESTNET,
        sourceAccount: user.publicKey(),
        sponsorAccount: sponsorAccount(),
        asset: usdc,
        ops: [{ kind: "createClaimableBalance", recipientId: "r", destination: Keypair.random().publicKey(), amount: "1" }],
        rows: [{ recipientId: "r", destination: "", amount: "1" }],
      })
    );
    expect(problems.map((p) => (typeof p === "string" ? p : p.code))).toEqual(["SENDER_NO_TRUSTLINE"]);
  }, 60_000);
});
