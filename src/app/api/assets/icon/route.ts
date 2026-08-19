import { NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { getSessionPublicKey } from "@/lib/auth/requireSession";
import { resolveAssetIcon } from "@/lib/stellar/assetIcon";

const querySchema = z.object({
  network: z.enum(["TESTNET", "PUBLIC"]),
  code: z.string().min(1).max(12),
  issuer: z.string().refine((v) => StrKey.isValidEd25519PublicKey(v), "Invalid issuer"),
});

/** SEP-1 icon lookup (home_domain -> stellar.toml -> CURRENCIES.image) for
 * a custom asset the user typed in — the curated known-asset list ships
 * its own icons and never calls this. */
export async function GET(request: Request) {
  const publicKey = await getSessionPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    network: url.searchParams.get("network"),
    code: url.searchParams.get("code"),
    issuer: url.searchParams.get("issuer"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const info = await resolveAssetIcon(parsed.data.network, parsed.data.code, parsed.data.issuer);
  return NextResponse.json(info);
}
