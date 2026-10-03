"use client";

import { SendReviewCard } from "@/components/distribution/SendReviewCard";
import type { ReviewInfo } from "@/components/distribution/useDistributionRun";

// Sample data only: shows the Mainnet confirmation step without a funded
// Mainnet sponsor. Nothing here can sign or send.
const SAMPLE: ReviewInfo = {
  runId: "preview",
  setupXdr: "",
  purpose: "SEND",
  transactionCount: 3,
  summary: { recipientCount: 250, totalAmount: "12500", asset: "USDC", network: "PUBLIC", kind: "PAYMENT" },
  preflight: { baseReserve: "0.5", senderNativeNeeded: "0", senderAssetNeeded: "12500", claimableReserve: "0", sponsorNeeded: "1.6" },
  expiresAt: Date.now() + 5 * 60_000,
};

export function MainnetGatePreview() {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <p className="mb-4 text-xs uppercase tracking-wide text-ink-faint">Preview with sample data (development only)</p>
      <SendReviewCard review={SAMPLE} network="PUBLIC" error={null} busy={false} onApprove={() => {}} onCancel={() => {}} />
    </div>
  );
}
