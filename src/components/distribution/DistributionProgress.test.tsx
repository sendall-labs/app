// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { RunView } from "@/lib/distribution/batchRuns";
import { DistributionProgress } from "./DistributionProgress";

afterEach(cleanup);

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run1",
    batchId: "b1",
    purpose: "SEND",
    status: "PAYMENTS_SUBMITTING",
    network: "TESTNET",
    sourceAccount: "GSENDER",
    setup: { hash: "s", txHash: "abcdef1234567890", submittedAt: new Date(), confirmedAt: new Date(), expiresAt: null },
    setupXdr: null,
    signedAt: new Date(Date.now() - 4200),
    completedAt: null,
    elapsedMs: 4200,
    errorCode: null,
    errorMessage: null,
    cleanupRequired: false,
    terminal: false,
    transactions: [
      { chunkIndex: 0, status: "SUCCESS", channel: "GC1", operationCount: 100, hash: "aaaaaa111", innerHash: "i1", errorCode: null, submittedAt: new Date(), confirmedAt: new Date() },
      { chunkIndex: 1, status: "SUBMITTING", channel: "GC2", operationCount: 50, hash: "bbbbbb222", innerHash: "i2", errorCode: null, submittedAt: new Date(), confirmedAt: null },
    ],
    recipients: { total: 150, succeeded: 100, failed: 0, pending: 50 },
    ...overrides,
  } as RunView;
}

function stageText(name: string) {
  return screen.getByText(name).closest("li")!;
}

describe("DistributionProgress", () => {
  it("shows the wallet step while waiting for the signature", () => {
    render(<DistributionProgress phase="awaiting-signature" run={null} transactionCount={2} />);
    expect(screen.getByText("Sending your distribution")).toBeTruthy();
    expect(screen.getByText("2 Stellar transactions")).toBeTruthy();
    expect(within(stageText("Wallet approval")).getByText(/One signature/)).toBeTruthy();
    expect(screen.queryByText(/Tx 1/)).toBeNull();
  });

  it("draws one lane per transaction with live status and explorer links", () => {
    render(<DistributionProgress phase="running" run={run()} transactionCount={2} />);
    expect(screen.getByText("100 of 150 delivered on Testnet")).toBeTruthy();
    expect(screen.getByText("67%")).toBeTruthy();
    const lanes = screen.getAllByRole("listitem").filter((li) => /^Tx \d/.test(li.textContent ?? ""));
    expect(lanes).toHaveLength(2);
    expect(within(lanes[0]).getByText("Confirmed")).toBeTruthy();
    expect(within(lanes[0]).getByRole("link").getAttribute("href")).toBe("https://stellar.expert/explorer/testnet/tx/aaaaaa111");
    expect(within(lanes[1]).getByText("Sending")).toBeTruthy();
    expect(within(lanes[1]).queryByRole("link")).toBeNull();
    expect(screen.getByText(/^\d+\.\ds$/)).toBeTruthy(); // elapsed timer
  });

  it("ends with a clear outcome", () => {
    const done = run({
      status: "PARTIALLY_FAILED",
      terminal: true,
      completedAt: new Date(),
      recipients: { total: 150, succeeded: 100, failed: 50, pending: 0 },
      transactions: [
        run().transactions[0],
        { ...run().transactions[1], status: "REAUTHORIZATION_REQUIRED", errorCode: "paymentNoTrust" },
      ],
    });
    render(<DistributionProgress phase="done" run={done} transactionCount={2} onDismiss={() => {}} />);
    expect(screen.getByText("Distribution partly delivered")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
});
