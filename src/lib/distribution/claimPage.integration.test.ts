import { afterAll, describe, expect, it } from "vitest";
import { Asset, Keypair, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer, getNetworkPassphrase, getRpcServer } from "@/lib/stellar/client";
import type { DistributionOp } from "./buildChunks";
import { buildClaimTx, listClaimable, submitClaimTx } from "./claimPage";
import { authorizeRun, prepareRun } from "./engine";
import { driveToEnd, fundedAccount, seedBatch, signLikeWallet, TESTNET } from "./testSupport";

describe.skipIf(!!process.env.CI)("public claim flow (Testnet)", () => {
  const batchIds: string[] = [];
  afterAll(() => prisma.batch.deleteMany({ where: { id: { in: batchIds } } }));

  it("lists a balance, adds the missing trustline and claims in one transaction", async () => {
    const issuer = await fundedAccount(); // sends its own asset
    const recipient = await fundedAccount(); // no trustline for it
    const tst = new Asset("CLM", issuer.publicKey());
    const batch = await seedBatch(issuer.publicKey(), [recipient.publicKey()], "CLAIMABLE_BALANCE", "25", {
      assetCode: "CLM",
      assetIssuer: issuer.publicKey(),
    });
    batchIds.push(batch.id);
    const ops: DistributionOp[] = [{ kind: "createClaimableBalance", recipientId: batch.recipients[0].id, destination: recipient.publicKey(), amount: "25" }];
    const prepared = await prepareRun({
      batchId: batch.id,
      network: TESTNET,
      sourceAccount: issuer.publicKey(),
      idempotencyKey: `claim-page-${batch.id}`,
      asset: tst,
      ops,
      claimExpiresAt: new Date(Date.now() + 86_400_000),
    });
    await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, issuer));
    expect((await driveToEnd(prepared.runId)).status).toBe("COMPLETED");

    const list = await listClaimable(TESTNET, recipient.publicKey(), batch.id);
    expect(list.accountExists).toBe(true);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ assetCode: "CLM", amount: "25.0000000", needsTrustline: true, fromBatch: true });
    expect(list.items[0].claimableUntil).toBeTruthy();

    // The sender sees nothing to claim yet (its window opens after expiry).
    expect((await listClaimable(TESTNET, issuer.publicKey())).items.find((i) => i.id === list.items[0].id)).toBeUndefined();

    const built = await buildClaimTx(TESTNET, recipient.publicKey(), [list.items[0].id]);
    const tx = TransactionBuilder.fromXDR(built.xdr, getNetworkPassphrase(TESTNET)) as Transaction;
    expect(tx.operations.map((o) => o.type)).toEqual(["changeTrust", "claimClaimableBalance"]);
    tx.sign(recipient);
    const res = await submitClaimTx(TESTNET, tx.toXDR());
    expect(res.status).toBe("SUCCESS");

    const row = await prisma.recipient.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(row).toMatchObject({ claimStatus: "CLAIMED", claimTxHash: res.hash });
    const account = await getHorizonServer(TESTNET).loadAccount(recipient.publicKey());
    expect(account.balances.find((b) => "asset_code" in b && b.asset_code === "CLM")?.balance).toBe("25.0000000");
    expect((await listClaimable(TESTNET, recipient.publicKey())).items).toHaveLength(0);
  }, 180_000);

  it("refuses non-claim transactions and inactive accounts", async () => {
    const someone = await fundedAccount();
    const relayed = new TransactionBuilder(await getRpcServer(TESTNET).getAccount(someone.publicKey()), {
      fee: "100",
      networkPassphrase: getNetworkPassphrase(TESTNET),
    })
      .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }))
      .setTimeout(60)
      .build();
    relayed.sign(someone);
    await expect(submitClaimTx(TESTNET, relayed.toXDR())).rejects.toMatchObject({ code: "SETUP_MISMATCH" });

    const ghost = Keypair.random().publicKey();
    expect((await listClaimable(TESTNET, ghost)).accountExists).toBe(false);
    await expect(buildClaimTx(TESTNET, ghost, ["00000000" + "ab".repeat(32)])).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
  }, 60_000);
});
