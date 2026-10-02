import { describe, expect, it } from "vitest";
import { Account, Asset, Keypair, MuxedAccount, Networks, TransactionBuilder, xdr, type Transaction } from "@stellar/stellar-sdk";
import { buildChunks, chunkCount, type DistributionOp } from "./buildChunks";

const sender = Keypair.random().publicKey();
const maxTime = new Date("2030-01-01T00:00:00Z");

function channels(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `ch${i}`,
    publicKey: Keypair.random().publicKey(),
    currentSequence: String(1000 * (i + 1)),
  }));
}

function payments(n: number): DistributionOp[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "payment" as const,
    recipientId: `r${i}`,
    destination: Keypair.random().publicKey(),
    amount: "1.5",
  }));
}

function decode(x: string) {
  return TransactionBuilder.fromXDR(x, Networks.TESTNET) as Transaction;
}

describe("buildChunks", () => {
  it.each([
    [1, 1],
    [100, 1],
    [101, 2],
    [1000, 10],
  ])("%i operations make %i chunks", (ops, chunks) => {
    expect(chunkCount(ops)).toBe(chunks);
    const built = buildChunks({ network: "TESTNET", sourceAccount: sender, asset: null, ops: payments(ops), channels: channels(chunks), maxTime });
    expect(built).toHaveLength(chunks);
    expect(built.reduce((n, c) => n + c.operationCount, 0)).toBe(ops);
    expect(built.at(-1)!.items.at(-1)!.recipientId).toBe(`r${ops - 1}`);
  });

  it("sources the tx from the channel at its next sequence and every op from the sender", () => {
    const chs = channels(2);
    const built = buildChunks({ network: "TESTNET", sourceAccount: sender, asset: null, ops: payments(150), channels: chs, maxTime });
    built.forEach((chunk, i) => {
      const tx = decode(chunk.xdr);
      expect(tx.source).toBe(chs[i].publicKey);
      expect(tx.sequence).toBe((BigInt(chs[i].currentSequence) + BigInt(1)).toString());
      expect(chunk.channelSequence).toBe(tx.sequence);
      expect(tx.operations.every((op) => op.source === sender)).toBe(true);
      expect(tx.timeBounds).toEqual({ minTime: "0", maxTime: String(maxTime.getTime() / 1000) });
      expect(tx.memo.type).toBe("none");
    });
  });

  it("returns a hash that survives an XDR round trip", () => {
    const [chunk] = buildChunks({ network: "TESTNET", sourceAccount: sender, asset: null, ops: payments(3), channels: channels(1), maxTime });
    expect(decode(chunk.xdr).hash().toString("hex")).toBe(chunk.hash);
    expect(chunk.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same inputs", () => {
    const ops = payments(5);
    const chs = channels(1);
    const a = buildChunks({ network: "TESTNET", sourceAccount: sender, asset: null, ops, channels: chs, maxTime });
    const b = buildChunks({ network: "TESTNET", sourceAccount: sender, asset: null, ops, channels: chs, maxTime });
    expect(a[0].hash).toBe(b[0].hash);
  });

  it("maps delivery methods and uses createAccount for new XLM accounts", () => {
    const dest = Keypair.random().publicKey();
    const muxed = new MuxedAccount(new Account(dest, "0"), "7").accountId();
    const [chunk] = buildChunks({
      network: "TESTNET",
      sourceAccount: sender,
      asset: null,
      ops: [
        { kind: "payment", recipientId: "a", destination: muxed, amount: "1" },
        { kind: "createAccount", recipientId: "b", destination: dest, amount: "2" },
      ],
      channels: channels(1),
      maxTime,
    });
    expect(chunk.items.map((i) => i.deliveryMethod)).toEqual(["PAYMENT", "CREATE_ACCOUNT"]);
    const ops = decode(chunk.xdr).operations;
    expect(ops[0].type).toBe("payment");
    expect(ops[1]).toMatchObject({ type: "createAccount", destination: dest, startingBalance: "2.0000000" });
  });

  it("builds claimable balances with recipient-before and sender-after predicates", () => {
    const usdc = new Asset("USDC", Keypair.random().publicKey());
    const recipient = Keypair.random().publicKey();
    const expires = new Date("2031-06-01T00:00:00Z");
    const [chunk] = buildChunks({
      network: "TESTNET",
      sourceAccount: sender,
      asset: usdc,
      ops: [{ kind: "createClaimableBalance", recipientId: "r", destination: recipient, amount: "10" }],
      channels: channels(1),
      maxTime,
      claimExpiresAt: expires,
    });
    const op = decode(chunk.xdr).operations[0];
    if (op.type !== "createClaimableBalance") throw new Error("wrong op");
    expect(op.source).toBe(sender);
    expect(op.asset.equals(usdc)).toBe(true);
    const [toRecipient, toSender] = op.claimants;
    expect(toRecipient.destination).toBe(recipient);
    expect(toSender.destination).toBe(sender);
    const deadline = BigInt(expires.getTime() / 1000);
    expect(toRecipient.predicate.switch()).toBe(xdr.ClaimPredicateType.claimPredicateBeforeAbsoluteTime());
    expect(BigInt(toRecipient.predicate.absBefore().toString())).toBe(deadline);
    expect(toSender.predicate.switch()).toBe(xdr.ClaimPredicateType.claimPredicateNot());
    expect(BigInt(toSender.predicate.notPredicate()!.absBefore().toString())).toBe(deadline);
    expect(chunk.items[0].deliveryMethod).toBe("CLAIMABLE_BALANCE");
  });

  it("refuses a claimable balance without an expiry", () => {
    expect(() =>
      buildChunks({
        network: "TESTNET",
        sourceAccount: sender,
        asset: null,
        ops: [{ kind: "createClaimableBalance", recipientId: "r", destination: Keypair.random().publicKey(), amount: "1" }],
        channels: channels(1),
        maxTime,
      })
    ).toThrow(/claimExpiresAt/);
  });

  it("refuses the wrong number of channels or a reused channel", () => {
    expect(() => buildChunks({ network: "TESTNET", sourceAccount: sender, asset: null, ops: payments(101), channels: channels(1), maxTime })).toThrow(/Expected 2/);
    const [c] = channels(1);
    expect(() => buildChunks({ network: "TESTNET", sourceAccount: sender, asset: null, ops: payments(101), channels: [c, c], maxTime })).toThrow(/distinct/);
  });
});
