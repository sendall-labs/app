import Image from "next/image";

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  const size = compact ? 24 : 28;

  return (
    <span className="inline-flex items-center gap-2.5">
      <Image src="/brand/logo.png" alt="" width={size} height={size} priority />
      <span className="text-lg font-bold tracking-tight">Sendall</span>
    </span>
  );
}
