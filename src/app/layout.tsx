import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/layout/header";
import { KbdShortcuts } from "@/components/kbd-shortcuts";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Tayf — Türkiye Haber Analizi",
    template: "%s — Tayf",
  },
  description:
    "Aynı haber, farklı dünyalar. 144 Türk kaynağından otomatik kümelenmiş politika haberleri, medya yanlılığı analizi ve kör nokta tespiti.",
  keywords: [
    "haber",
    "türkiye",
    "politika",
    "medya",
    "yanlılık",
    "kör nokta",
    "haber analizi",
  ],
  authors: [{ name: "Tayf" }],
  creator: "Tayf",
  openGraph: {
    type: "website",
    locale: "tr_TR",
    url: "/",
    siteName: "Tayf",
    title: "Tayf — Türkiye Haber Analizi",
    description:
      "Aynı haber, farklı dünyalar. Türk medyasının aynı habere bakışını tek ekranda görün.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tayf — Türkiye Haber Analizi",
    description: "Aynı haber, farklı dünyalar.",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "/",
    types: {
      "application/rss+xml": [
        { url: "/rss.xml", title: "Tayf — Haberler RSS" },
      ],
    },
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <KbdShortcuts />
      </body>
    </html>
  );
}
