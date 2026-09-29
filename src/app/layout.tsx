import type { Metadata } from "next";
import { Caveat, Geist, Public_Sans } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/seo/siteUrl";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

// Used only by the public schedule UI (.org-theme) — the dashboard keeps Geist.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// The handwritten margin notes on the public landing page only.
const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Dropin — Visual Scheduling for Recreation",
    template: "%s | Dropin",
  },
  // The positioning line, docs/POSITIONING.md. Pages with their own
  // description (the facility pages, /find) override it.
  description:
    "A visual schedule for recreation centres. Dropin shows patrons and staff what's on, and where.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    siteName: "Dropin",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${publicSans.variable} ${caveat.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
