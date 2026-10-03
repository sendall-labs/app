import { notFound } from "next/navigation";
import { MainnetGatePreview } from "@/components/preview/MainnetGatePreview";

// Development-only page used for the Mainnet gate screenshot; it does
// not exist in production builds.
export default function MainnetGatePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MainnetGatePreview />;
}
