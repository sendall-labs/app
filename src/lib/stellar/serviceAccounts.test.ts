import { afterEach, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { getSponsorKeypair, isSponsorConfigured, ServiceAccountNotConfiguredError } from "./serviceAccounts";

describe("sponsor account config", () => {
  const saved = process.env.SPONSOR_SECRET_PUBLIC;
  afterEach(() => {
    if (saved === undefined) delete process.env.SPONSOR_SECRET_PUBLIC;
    else process.env.SPONSOR_SECRET_PUBLIC = saved;
  });

  it("loads the sponsor for the requested network only", () => {
    const kp = Keypair.random();
    process.env.SPONSOR_SECRET_PUBLIC = kp.secret();
    expect(getSponsorKeypair("PUBLIC").publicKey()).toBe(kp.publicKey());
    expect(isSponsorConfigured("PUBLIC")).toBe(true);
  });

  it("throws a named error when not configured", () => {
    delete process.env.SPONSOR_SECRET_PUBLIC;
    expect(isSponsorConfigured("PUBLIC")).toBe(false);
    expect(() => getSponsorKeypair("PUBLIC")).toThrow(ServiceAccountNotConfiguredError);
  });
});
