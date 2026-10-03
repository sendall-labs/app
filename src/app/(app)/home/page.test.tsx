// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const wallet = { address: null as string | null, authenticated: false, network: "TESTNET" };
vi.mock("@/components/wallet/WalletProvider", () => ({ useWallet: () => wallet }));
vi.mock("@/components/wallet/ConnectButton", () => ({ ConnectButton: () => null }));

import HomePage from "./page";

const fetchMock = vi.fn((url: string) =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve(url.startsWith("/api/wallet/balances") ? { balances: [{ assetCode: "XLM", assetIssuer: null, balance: "9876.5" }] } : { batches: [] }),
  })
);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  Object.assign(wallet, { address: null, authenticated: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const balanceCalls = () => fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/wallet/balances"));

describe("HomePage balances", () => {
  it("waits for the sign-in before asking for balances, then loads them", async () => {
    // The wallet has answered with its address, but the sign-in has not
    // landed yet: asking now would get a 401 and show it as an error.
    wallet.address = "GABC";
    const { rerender } = render(<HomePage />);
    expect(screen.getByText("Sign in with your wallet to see balances.")).toBeTruthy();
    expect(balanceCalls()).toHaveLength(0);

    wallet.authenticated = true;
    rerender(<HomePage />);
    expect(await screen.findByText("9,876.5")).toBeTruthy();
    expect(balanceCalls()).toHaveLength(1);
  });

  it("reloads the batch list when the sign-in lands", async () => {
    const { rerender } = render(<HomePage />);
    await screen.findByText(/No batches yet/);
    wallet.address = "GABC";
    wallet.authenticated = true;
    rerender(<HomePage />);
    await screen.findByText("9,876.5");
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/batches")).toHaveLength(2);
  });
});
