import { CreateBatch } from "@/components/batches/CreateBatch";

// Sidebar: "Bulk Claimable Balance". A path rather than ?kind= so the
// shell can highlight it without reading search params during render.
export default function NewClaimableBatchPage() {
  return <CreateBatch kind="CLAIMABLE_BALANCE" />;
}
