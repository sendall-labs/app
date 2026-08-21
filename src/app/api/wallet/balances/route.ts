import { NextResponse } from "next/server";
import { NotFoundError } from "@stellar/stellar-sdk";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { getHorizonServer } from "@/lib/stellar/client";
import type { Network } from "@/generated/prisma/enums";

type WalletBalance = { assetCode: string; assetIssuer: string | null; balance: string };

export async function GET(request: Request) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const network = new URL(request.url).searchParams.get("network");
  if (network !== "TESTNET" && network !== "PUBLIC") {
    return NextResponse.json({ error: "Invalid network" }, { status: 400 });
  }

  try {
    const account = await getHorizonServer(network as Network).loadAccount(publicKey);
    // Sendall only ever sends XLM or a plain issued asset — liquidity pool
    // shares aren't a payable asset here, so they're left out.
    const balances = account.balances.flatMap<WalletBalance>((b) => {
      if (b.asset_type === "native") return [{ assetCode: "XLM", assetIssuer: null, balance: b.balance }];
      if (b.asset_type === "liquidity_pool_shares") return [];
      return [{ assetCode: b.asset_code, assetIssuer: b.asset_issuer, balance: b.balance }];
    });
    return NextResponse.json({ balances });
  } catch (err) {
    // Not yet funded on this network — an empty balance list, not an error.
    if (err instanceof NotFoundError) return NextResponse.json({ balances: [] });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load balances" },
      { status: 500 }
    );
  }
}
