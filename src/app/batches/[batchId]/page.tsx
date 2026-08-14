"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";

type Recipient = {
  id: string;
  rowIndex: number;
  destination: string;
  amount: string;
  addressValid: boolean;
  isDuplicate: boolean;
  accountExists: boolean | null;
  hasTrustline: boolean | null;
  status: string;
  errorMessage: string | null;
};

type Batch = {
  id: string;
  status: string;
  network: string;
  assetCode: string | null;
  assetIssuer: string | null;
  sourceAccount: string;
  recipients: Recipient[];
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  VALIDATION_FAILED: "Invalid",
  CHECK_FAILED: "Check failed",
  READY: "Ready",
  IN_TRANSACTION: "Submitting",
  SUCCESS: "Sent",
  FAILED: "Failed",
};

export default function BatchReviewPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const { signTransaction } = useWallet();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/batches/${batchId}`);
    if (!res.ok) return;
    const { batch } = await res.json();
    setBatch(batch);
  }, [batchId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/batches/${batchId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setBatch(data.batch);
      });
    return () => {
      cancelled = true;
    };
  }, [batchId]);
