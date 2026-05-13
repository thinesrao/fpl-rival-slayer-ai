import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";
import { PwaShell } from "@/components/PwaShell";

export const metadata: Metadata = {
  title: "FPL Rival Slayer AI",
  description:
    "AI-powered Fantasy Premier League coach focused on overtaking the 2-3 managers directly above you in your mini-league.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Rival Slayer",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon-180.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#16a34a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>
          {children}
          <Toaster richColors position="top-right" />
          <PwaShell />
        </Providers>
      </body>
    </html>
  );
}
