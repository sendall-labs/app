import { Horizon, StellarToml } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";
import { NETWORK_CONFIG } from "./client";

export type AssetIconInfo = { image: string | null; name: string | null };

// SEP-1: look up the account's home_domain on Horizon, fetch that domain's
// /.well-known/stellar.toml, and pull the CURRENCIES entry matching this
// code+issuer. This is how a wallet is actually supposed to discover an
// asset's real icon — not something to guess or hand-maintain per asset.
const cache = new Map<string, AssetIconInfo>();

export async function resolveAssetIcon(network: Network, code: string, issuer: string): Promise<AssetIconInfo> {
  const cacheKey = `${network}:${issuer}:${code}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const result: AssetIconInfo = { image: null, name: null };
  try {
    const server = new Horizon.Server(NETWORK_CONFIG[network].horizonUrl);
    const account = await server.accounts().accountId(issuer).call();
    const homeDomain = account.home_domain;
    if (homeDomain) {
      const toml = await StellarToml.Resolver.resolve(homeDomain);
      const currency = (toml.CURRENCIES ?? []).find((c) => c.code === code && c.issuer === issuer);
      if (currency) {
        result.image = currency.image ?? null;
        result.name = currency.name ?? null;
      }
    }
  } catch {
    // No home_domain, no toml, asset not listed in it, network hiccup —
    // all just mean "no icon available," not an error worth surfacing.
  }
  cache.set(cacheKey, result);
  return result;
}
