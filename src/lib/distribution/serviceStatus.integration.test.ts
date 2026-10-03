import { afterEach, describe, expect, it } from "vitest";
import { feeCapPerOp } from "./feeBump";
import { serviceStatus } from "./serviceStatus";

describe("fee cap per network", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("uses the network override, then the shared cap, then 10,000; blanks never mean 0", () => {
    process.env.FEE_CAP_STROOPS_PER_OP_PUBLIC = "";
    delete process.env.FEE_CAP_STROOPS_PER_OP;
    expect(feeCapPerOp("PUBLIC")).toBe(BigInt(10_000));
    process.env.FEE_CAP_STROOPS_PER_OP = "5000";
    expect(feeCapPerOp("PUBLIC")).toBe(BigInt(5000));
    process.env.FEE_CAP_STROOPS_PER_OP_PUBLIC = "2000";
    expect(feeCapPerOp("PUBLIC")).toBe(BigInt(2000));
    expect(feeCapPerOp("TESTNET")).toBe(BigInt(5000));
  });
});

describe.skipIf(!!process.env.CI)("service status (Testnet + local DB)", () => {
  it("reports Testnet ready with a funded sponsor and channels", async () => {
    const s = await serviceStatus("TESTNET");
    expect(s).toMatchObject({ ready: true, rpcConfigured: true, sponsorConfigured: true, sponsorLow: false });
    expect(s.channelsTotal).toBeGreaterThanOrEqual(20);
    expect(Number(s.sponsorSpendableXlm)).toBeGreaterThan(100);
  }, 30_000);

  it("reports Mainnet not ready until a sponsor and channels exist", async () => {
    const saved = process.env.SPONSOR_SECRET_PUBLIC;
    delete process.env.SPONSOR_SECRET_PUBLIC;
    try {
      const s = await serviceStatus("PUBLIC");
      expect(s.ready).toBe(false);
      expect(s.reasons).toContain("Sponsor account is not configured.");
      expect(s.reasons).toContain("No channel accounts are provisioned.");
    } finally {
      if (saved !== undefined) process.env.SPONSOR_SECRET_PUBLIC = saved;
    }
  }, 30_000);
});
