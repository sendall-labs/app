import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { authorizeRun, prepareRun } from "@/lib/distribution/engine";
import { driveToEnd, fundedAccount, randomKeys, seedBatch, signLikeWallet, TESTNET } from "@/lib/distribution/testSupport";
import { loadReceipt } from "./receiptData";
import { renderReceipt } from "./render";

export const RECEIPT_SAMPLE = path.resolve(__dirname, "../../../test-results/receipt-sample.pdf");

describe.skipIf(!!process.env.CI)("receipt of a real distribution (Testnet)", () => {
  const ids: string[] = [];
  afterAll(() => prisma.batch.deleteMany({ where: { id: { in: ids } } }));

  it("lists every row with its method, status and transaction", async () => {
    const sender = await fundedAccount();
    const batch = await seedBatch(sender.publicKey(), randomKeys(150), "PAYMENT", "1.5", { accountExists: false });
    ids.push(batch.id);
    const prepared = await prepareRun({
      batchId: batch.id,
      network: TESTNET,
      sourceAccount: sender.publicKey(),
      idempotencyKey: `receipt-${batch.id}`,
      asset: null,
      ops: batch.recipients.map((r) => ({ kind: "createAccount" as const, recipientId: r.id, destination: r.destination, amount: "1.5" })),
    });
    await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, sender));
    expect((await driveToEnd(prepared.runId)).status).toBe("COMPLETED");
    await prisma.batch.update({ where: { id: batch.id }, data: { status: "COMPLETED" } });

    const data = await loadReceipt(batch.id);
    expect(data).toMatchObject({
      sender: sender.publicKey(),
      network: "TESTNET",
      asset: { code: "XLM", issuer: null },
      recipientCount: 150,
      deliveredCount: 150,
      deliveredAmount: "225",
      failedCount: 0,
      transactionCount: 2,
    });
    expect(data.authorizationTxs).toHaveLength(1);
    expect(data.rows.every((r) => r.method === "Account creation" && r.status === "Delivered" && /^[0-9a-f]{64}$/.test(r.txHash!))).toBe(true);
    expect(data.number).toMatch(/^SND-[A-Z0-9]{8}$/);

    const pdf = await renderReceipt(data);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    writeFileSync(RECEIPT_SAMPLE, pdf);
  }, 240_000);
});
