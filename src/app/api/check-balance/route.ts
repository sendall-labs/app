import { NextResponse } from "next/server";
import { z } from "zod";
import { Asset } from "@stellar/stellar-sdk";
import { parseAddressList } from "@/lib/csv/parseAddressList";
import { checkRecipients } from "@/lib/stellar/balanceCheck";
import type { Network } from "@/generated/prisma/enums";

// Stateless and unauthenticated (by design — this is a lookup tool, not
// tied to any account), so it gets its own tighter cap independent of
// MAX_ADDRESS_LIST_ROWS to keep a single request's RPC fan-out bounded.
const MAX_CHECK_ADDRESSES = 500;

const bodySchema = z.object({
  text: z.string().min(1),
  network: z.enum(["TESTNET", "PUBLIC"]),
  assetCode: z.string().optional(),
  assetIssuer: z.string().optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { text, network, assetCode, assetIssuer } = parsed.data;

  const { rows, errors, truncated } = parseAddressList(text);
  const valid = rows.filter((r) => r.addressValid).slice(0, MAX_CHECK_ADDRESSES);
  const cappedByCheckLimit = rows.filter((r) => r.addressValid).length > MAX_CHECK_ADDRESSES;

  if (valid.length === 0) {
    return NextResponse.json({ results: [], parseErrors: errors, truncated });
  }

  const asset = assetCode && assetIssuer ? new Asset(assetCode, assetIssuer) : null;

  try {
    const checked = await checkRecipients(
      network as Network,
      valid.map((r) => ({ destination: r.address, amount: "0" })),
      asset
    );

    const results = valid.map((r) => {
      const check = checked.get(r.address);
      return {
        name: r.name,
        address: r.address,
        accountExists: check?.accountExists ?? false,
        currentBalance: check?.currentBalance ?? null,
        hasTrustline: check?.hasTrustline ?? null,
        ok: check?.ok ?? false,
        reason: check?.reason,
      };
    });

    return NextResponse.json({
      results,
      parseErrors: errors,
      truncated: truncated || cappedByCheckLimit,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Check failed" },
      { status: 500 }
    );
  }
}
