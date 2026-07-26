import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getMaison } from "@/lib/maison";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const maison = await getMaison();
  return {
    title: `${maison.displayName} — ERP`,
    description: `ERP et point de vente · ${maison.displayName}, ${maison.city}`,
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
