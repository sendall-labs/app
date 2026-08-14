"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";

export default function NewBatchPage() {
  const router = useRouter();
  const { network, address } = useWallet();
  const [file, setFile] = useState<File | null>(null);
  const [assetCode, setAssetCode] = useState("");
  const [assetIssuer, setAssetIssuer] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!address) {
      toast.error("Connect and sign in with your wallet first");
      return;
    }
    if (!file) {
      toast.error("Choose a CSV file first");
      return;
    }

    setSubmitting(true);
    try {
      const csvText = await file.text();
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvText,
          csvFileName: file.name,
          network,
          sourceAccount: address,
          assetCode: assetCode || undefined,
          assetIssuer: assetIssuer || undefined,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? "Failed to create batch");
      }
      const { batch, parseErrors } = await res.json();
      if (parseErrors?.length) {
        toast.warning(`${parseErrors.length} row(s) skipped — missing destination/amount`);
      }
      router.push(`/batches/${batch.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create batch");
    } finally {
      setSubmitting(false);
    }
  }, [address, assetCode, assetIssuer, file, network, router]);

