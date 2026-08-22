import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { Toaster } from "sonner";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    `https://${process.env.NEXT_PUBLIC_HOME_DOMAIN ?? "app.sendall.xyz"}`,
  ),
  title: "Sendall",
  description: "Non-custodial bulk payments for Stellar",
  applicationName: "Sendall",
  openGraph: {
    title: "Sendall",
    description: "Non-custodial bulk payments for Stellar",
    siteName: "Sendall",
    type: "website",
    images: [{ url: "/brand/social-card.png", width: 1200, height: 630, alt: "Sendall" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sendall",
    description: "Non-custodial bulk payments for Stellar",
    images: ["/brand/social-card.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <WalletProvider>
          {children}
          <Toaster richColors position="bottom-right" theme="system" />
        </WalletProvider>
      </body>
    </html>
  );
}
