// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ClaimStatusCard } from "./ClaimStatusCard";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ClaimStatusCard", () => {
  it("flips to closed and offers the reclaim while the page stays open", () => {
    vi.useFakeTimers();
    const summary = {
      created: 3,
      unclaimed: 2,
      claimed: 1,
      reclaimed: 0,
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
      syncedAt: new Date().toISOString(),
    };
    render(<ClaimStatusCard summary={summary} syncing={false} onRefresh={() => {}} reclaimAction={<button>Reclaim 2 unclaimed</button>} />);
    expect(screen.getByText(/left to claim/)).toBeTruthy();
    expect(screen.queryByText("Reclaim 2 unclaimed")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(screen.getByText("Claim window closed")).toBeTruthy();
    expect(screen.getByText("Reclaim 2 unclaimed")).toBeTruthy();
  });

  it("never offers a reclaim when nothing is unclaimed", () => {
    const summary = { created: 1, unclaimed: 0, claimed: 1, reclaimed: 0, expiresAt: new Date(Date.now() - 1000).toISOString(), syncedAt: "" };
    render(<ClaimStatusCard summary={summary} syncing={false} onRefresh={() => {}} reclaimAction={<button>Reclaim</button>} />);
    expect(screen.queryByText("Reclaim")).toBeNull();
  });
});
