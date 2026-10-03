import { NextResponse } from "next/server";
import { serviceStatus } from "@/lib/distribution/serviceStatus";

/**
 * Public, read-only: can Sendall send on this network right now? Only
 * readiness facts are returned; no keys and no account identifiers.
 */
export async function GET(request: Request) {
  const network = new URL(request.url).searchParams.get("network");
  if (network !== "TESTNET" && network !== "PUBLIC") return NextResponse.json({ error: "network must be TESTNET or PUBLIC" }, { status: 400 });
  const s = await serviceStatus(network);
  return NextResponse.json({ network: s.network, ready: s.ready, reasons: s.reasons, sponsorLow: s.sponsorLow, channelsAvailable: s.channelsAvailable });
}
