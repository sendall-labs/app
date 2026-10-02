export type KnownAsset = {
  code: string;
  domain: string;
  accentClass: string;
  // Real brand icon, downloaded from Stellar Lab / stellar.expert and
  // served locally (public/assets/tokens) instead of hotlinked — no
  // external request at render time, nothing to break if a third-party
  // CDN changes. null falls back to the monogram badge below.
  icon: string | null;
  // null = native XLM, no issuer needed. Otherwise the verified issuer per
  // network — an asset not listed for a given network (AQUA has no
  // testnet entry below) is filtered out of the picker while that
  // network's selected, rather than showing an issuer that doesn't exist.
  issuer: Partial<Record<"TESTNET" | "PUBLIC", string>> | null;
};

// Every issuer here is verified against an official source — never invent
// one from memory, a wrong address silently misdirects funds:
// - USDC/EURC: developers.circle.com/stablecoins/{usdc,eurc}-contract-addresses
// - AQUA: aqua.network/.well-known/stellar.toml (mainnet only; Aquarius
//   doesn't run a testnet issuer)
export const KNOWN_ASSETS: KnownAsset[] = [
  {
    code: "XLM",
    domain: "Stellar Network",
    accentClass: "bg-ink text-paper",
    icon: "/assets/tokens/xlm.png",
    issuer: null,
  },
  {
    code: "USDC",
    domain: "circle.com",
    accentClass: "bg-[#2775CA] text-white",
    icon: "/assets/tokens/usdc.png",
    issuer: {
      PUBLIC: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      TESTNET: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    },
  },
  {
    code: "EURC",
    domain: "circle.com",
    accentClass: "bg-[#2775CA] text-white",
    icon: "/assets/tokens/eurc.png",
    issuer: {
      PUBLIC: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
      TESTNET: "GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO",
    },
  },
  {
    code: "AQUA",
    domain: "aqua.network",
    accentClass: "bg-[#8B5CF6] text-white",
    icon: "/assets/tokens/aqua.png",
    issuer: { PUBLIC: "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA" },
  },
];

export function findKnownAsset(code: string): KnownAsset | undefined {
  const upper = code.trim().toUpperCase();
  return KNOWN_ASSETS.find((a) => a.code === upper);
}

export function issuerForNetwork(asset: KnownAsset, network: string): string | undefined {
  return asset.issuer?.[network as "TESTNET" | "PUBLIC"];
}
