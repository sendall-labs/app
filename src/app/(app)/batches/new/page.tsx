import { CreateBatch } from "@/components/batches/CreateBatch";

// Sidebar: "Bulk Payment". Same editor as claimable balances; the type
// can still be switched on the batch page before anything is signed.
export default function NewPaymentBatchPage() {
  return <CreateBatch kind="PAYMENT" />;
}
