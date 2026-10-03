// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PreflightProblems, SendReviewCard } from "./SendReviewCard";
import { RunRequestError, type ReviewInfo } from "./useDistributionRun";

afterEach(cleanup);

const base: ReviewInfo = {
  runId: "r1",
  setupXdr: "AAAA",
  purpose: "SEND",
  transactionCount: 3,
  summary: { recipientCount: 300, totalAmount: "1500", asset: "USDC", network: "TESTNET", kind: "CLAIMABLE_BALANCE" },
  preflight: { baseReserve: "0.5", senderNativeNeeded: "300", senderAssetNeeded: "1500", claimableReserve: "300", sponsorNeeded: "1.6" },
  expiresAt: Date.now() + 4 * 60_000,
};

describe("SendReviewCard", () => {
  it("summarizes what will be signed and who pays", () => {
    render(<SendReviewCard network="TESTNET" review={base} error={null} busy={false} onApprove={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("300")).toBeTruthy();
    expect(screen.getByText("1500 USDC")).toBeTruthy();
    expect(screen.getByText("Claimable balances")).toBeTruthy();
    expect(screen.getByText("300 XLM")).toBeTruthy(); // reserve locked
    expect(screen.getByText(/0.5 XLM per claimant/)).toBeTruthy();
    expect(screen.getByText("Covered by Sendall")).toBeTruthy();
    expect(screen.getByText("Testnet")).toBeTruthy();
    expect(screen.getByText(/^[34]:\d\d$/)).toBeTruthy();
  });

  it("marks Mainnet as real funds and needs MAINNET typed before approving", () => {
    const onApprove = vi.fn();
    const review = { ...base, summary: { ...base.summary!, network: "PUBLIC", kind: "PAYMENT" } };
    render(<SendReviewCard network="PUBLIC" review={review} error={null} busy={false} onApprove={onApprove} onCancel={() => {}} />);
    expect(screen.getByText("Mainnet (real funds)")).toBeTruthy();
    expect(screen.getByText("Direct payments")).toBeTruthy();
    expect(screen.queryByText("Reserve locked")).toBeNull();
    const approve = screen.getByRole("button", { name: "Approve in wallet" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    const input = screen.getByLabelText("Type MAINNET to confirm");
    fireEvent.change(input, { target: { value: "mainnet?" } });
    expect(approve.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "mainnet" } });
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("needs no typed confirmation on Testnet", () => {
    render(<SendReviewCard network="TESTNET" review={base} error={null} busy={false} onApprove={() => {}} onCancel={() => {}} />);
    expect(screen.queryByLabelText("Type MAINNET to confirm")).toBeNull();
    expect((screen.getByRole("button", { name: "Approve in wallet" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("approves, cancels, and shows a wallet rejection", () => {
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    const err = new RunRequestError("The wallet did not approve. Nothing was sent; you can approve again or cancel.", "WALLET_REJECTED");
    render(<SendReviewCard network="TESTNET" review={base} error={err} busy={false} onApprove={onApprove} onCancel={onCancel} />);
    expect(screen.getByRole("alert").textContent).toMatch(/did not approve/);
    fireEvent.click(screen.getByRole("button", { name: "Approve in wallet" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("blocks approval once the window has closed", () => {
    render(<SendReviewCard network="TESTNET" review={{ ...base, expiresAt: Date.now() - 1 }} error={null} busy={false} onApprove={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Window closed")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Approve in wallet" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains a cleanup", () => {
    render(<SendReviewCard network="TESTNET" review={{ ...base, purpose: "CLEANUP", signerCount: 2, summary: null, preflight: null }} error={null} busy={false} onApprove={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Remove leftover signers")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });
});

describe("PreflightProblems", () => {
  it("lists problems with row numbers", () => {
    const err = new RunRequestError("2 problems", "PREFLIGHT_FAILED", [
      { code: "MEMO_UNSUPPORTED", message: "Rows with a memo cannot be sent in bulk.", recipientId: "a" },
      { code: "SENDER_XLM_SHORT", message: "Your account needs 20 XLM free." },
    ]);
    render(<PreflightProblems error={err} rowNumberOf={(id) => (id === "a" ? 4 : undefined)} onDismiss={() => {}} />);
    expect(screen.getByText("Nothing was sent")).toBeTruthy();
    expect(screen.getByText("Row 4")).toBeTruthy();
    expect(screen.getByText("Your account needs 20 XLM free.")).toBeTruthy();
  });
});
