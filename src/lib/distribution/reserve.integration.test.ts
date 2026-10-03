import { describe, expect, it } from "vitest";
import { Asset, Claimant, Keypair, Operation } from "@stellar/stellar-sdk";
import { getHorizonServer } from "@/lib/stellar/client";
import { getSponsorKeypair } from "@/lib/stellar/serviceAccounts";
import type { DistributionOp } from "./buildChunks";
import { DistributionError } from "./errors";
import { runPreflight } from "./preflight";
import { claimableBalanceReserve, getBaseReserveStroops, loadAccountFunds, toStroops } from "./reserve";
import { fundedAccount, randomKeys, submitAs, TESTNET } from "./testSupport";

describe.skipIf(!!process.env.CI)("claimable balance reserve (Testnet)", () => {
  it("locks one base reserve per claimant: 2 claimants = 1 XLM per balance", async () => {
    const sender = await fundedAccount();
    const horizon = getHorizonServer(TESTNET);
    const base = await getBaseReserveStroops(TESTNET);
    const before = await horizon.loadAccount(sender.publicKey());
    const fundsBefore = await loadAccountFunds(TESTNET, sender.publicKey(), base, null);

    const deadline = Math.floor(Date.now() / 1000 + 86_400).toString();
    const recipientCan = Claimant.predicateBeforeAbsoluteTime(deadline);
    await submitAs(sender, (b) =>
      b.addOperation(
        Operation.createClaimableBalance({
          asset: Asset.native(),
          amount: "1",
          claimants: [new Claimant(Keypair.random().publicKey(), recipientCan), new Claimant(sender.publicKey(), Claimant.predicateNot(recipientCan))],
        })
      )
    );

    const after = await horizon.loadAccount(sender.publicKey());
    const fundsAfter = await loadAccountFunds(TESTNET, sender.publicKey(), base, null);
    // The sender now sponsors two claimant entries...
    expect((after.num_sponsoring ?? 0) - (before.num_sponsoring ?? 0)).toBe(2);
    // ...so its spendable XLM fell by the amount, the fee and 2 base reserves.
    const fee = toStroops("0.0001"); // submitAs bids 1000 stroops; charged at the ledger's rate (100)
    const drop = fundsBefore.spendableNative - fundsAfter.spendableNative;
    expect(drop - toStroops("1")).toBeLessThanOrEqual(BigInt(2) * base + fee);
    expect(drop - toStroops("1")).toBeGreaterThanOrEqual(BigInt(2) * base);
    expect(claimableBalanceReserve(1, base)).toBe(BigInt(2) * base);
    console.info(`base reserve ${base} stroops; one 2-claimant balance locked ${BigInt(2) * base} stroops`);
  }, 60_000);

  it("blocks a claimable distribution the sender cannot cover, counting the reserve", async () => {
    // 20 XLM: 1 locked as minimum balance; 30 balances of 0.1 XLM need
    // 3 XLM + 30 XLM of reserve.
    const funder = await fundedAccount();
    const sender = Keypair.random();
    await submitAs(funder, (b) => b.addOperation(Operation.createAccount({ destination: sender.publicKey(), startingBalance: "20" })));
    const ops: DistributionOp[] = randomKeys(30).map((d, i) => ({ kind: "createClaimableBalance", recipientId: `r${i}`, destination: d, amount: "0.1" }));
    try {
      await runPreflight({
        network: TESTNET,
        sourceAccount: sender.publicKey(),
        sponsorAccount: getSponsorKeypair(TESTNET).publicKey(),
        asset: null,
        ops,
        rows: ops.map((o) => ({ recipientId: o.recipientId, destination: "", amount: "0.1" })),
      });
      throw new Error("expected the preflight to block");
    } catch (err) {
      expect(err).toBeInstanceOf(DistributionError);
      const problems = (err as DistributionError).details!.problems as { code: string; message: string }[];
      expect(problems).toHaveLength(1);
      expect(problems[0].code).toBe("SENDER_XLM_SHORT");
      expect(problems[0].message).toMatch(/33 XLM free.*including 30 XLM locked by claimable balances/);
    }

    // 10 balances fit: 1 + 10 = 11 XLM needed, 19 available.
    const fits = ops.slice(0, 10);
    const summary = await runPreflight({
      network: TESTNET,
      sourceAccount: sender.publicKey(),
      sponsorAccount: getSponsorKeypair(TESTNET).publicKey(),
      asset: null,
      ops: fits,
      rows: fits.map((o) => ({ recipientId: o.recipientId, destination: "", amount: "0.1" })),
    });
    expect(summary).toMatchObject({ claimableReserve: "10", senderNativeNeeded: "11" });
  }, 60_000);
});
