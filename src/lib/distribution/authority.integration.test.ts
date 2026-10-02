import { describe, expect, it } from "vitest";
import { Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { getHorizonServer, getNetworkPassphrase, NETWORK_CONFIG } from "@/lib/stellar/client";
import { loadAccountAuthority, planAuthority } from "./authority";

describe.skipIf(!!process.env.CI)("authority (Testnet integration)", () => {
  it("reads real thresholds and rejects a multisig account", async () => {
    const kp = Keypair.random();
    const fund = await fetch(`${NETWORK_CONFIG.TESTNET.friendbot}?addr=${kp.publicKey()}`);
    expect(fund.ok).toBe(true);

    const fresh = await loadAccountAuthority("TESTNET", kp.publicKey());
    expect(planAuthority(fresh, 10)).toMatchObject({ freeSignerSlots: 20, preAuthWeight: 1 });

    const horizon = getHorizonServer("TESTNET");
    const tx = new TransactionBuilder(await horizon.loadAccount(kp.publicKey()), {
      fee: "100",
      networkPassphrase: getNetworkPassphrase("TESTNET"),
    })
      .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: Keypair.random().publicKey(), weight: 1 } }))
      .addOperation(Operation.setOptions({ lowThreshold: 1, medThreshold: 2, highThreshold: 2 }))
      .setTimeout(60)
      .build();
    tx.sign(kp);
    await horizon.submitTransaction(tx);

    const multisig = await loadAccountAuthority("TESTNET", kp.publicKey());
    expect(multisig.thresholds).toEqual({ low: 1, medium: 2, high: 2 });
    expect(multisig.additionalSigners).toHaveLength(1);
    expect(() => planAuthority(multisig, 1)).toThrow(/Multi-signature/);
  }, 60_000);

  it("reports a missing account", async () => {
    await expect(loadAccountAuthority("TESTNET", Keypair.random().publicKey())).rejects.toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
    });
  }, 30_000);
});
