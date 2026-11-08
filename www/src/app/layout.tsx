import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Poppins, Unbounded, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/** Match workstation-website: Unbounded display, Poppins body, JetBrains Mono. */
const unbounded = Unbounded({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

const SITE_URL = "https://www.vyltzero.com";
const DESCRIPTION =
  "VYLTZERO is the vault for AI agents: workload identity and Kubernetes auth, short-lived agent session tokens, and an HTTP and MCP credential broker so agents act with delegated authority and never hold static keys — on a self-hosted, Rust-powered secrets platform with envelope encryption, transit, PKI, signed audit and multi-region replication.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "VYLTZERO — The Vault for AI Agents. Zero Keys. Agent Authority.",
    template: "%s · VyltZero",
  },
  description: DESCRIPTION,
  keywords: [
    "AI agent security",
    "agent credentials",
    "MCP",
    "credential broker",
    "workload identity",
    "zero trust",
    "secrets manager",
    "vault",
    "envelope encryption",
    "AES-256-GCM",
    "multi-region",
    "high availability",
    "PKI",
    "dynamic secrets",
    "transit encryption",
    "Kubernetes",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: "VYLTZERO — The Vault for AI Agents. Zero Keys. Agent Authority.",
    description: DESCRIPTION,
    siteName: "VyltZero",
  },
  twitter: {
    card: "summary_large_image",
    title: "VYLTZERO — The Vault for AI Agents. Zero Keys. Agent Authority.",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#11161d",
  colorScheme: "dark",
};

/** Google Analytics 4 property for www.vyltzero.com. */
const GA_MEASUREMENT_ID = "G-JXX0FL4PEP";

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "VYLTZERO",
  applicationCategory: "SecurityApplication",
  operatingSystem: "Linux, Kubernetes",
  description: DESCRIPTION,
  url: SITE_URL,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${unbounded.variable} ${poppins.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
        {/* Google tag (gtag.js) */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
      </body>
    </html>
  );
}
