import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sendall",
    short_name: "Sendall",
    description: "Non-custodial bulk payments for Stellar",
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAF8",
    theme_color: "#2F5FDA",
    icons: [{ src: "/icon.png", sizes: "192x192", type: "image/png" }],
  };
}
