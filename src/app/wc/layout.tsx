import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WC26 Fantasy AI — World Cup 2026 Fantasy Manager Dashboard",
  description:
    "AI-driven manager dashboard for the official FIFA World Cup 2026™ Fantasy game: live data, AI squad drafts, matchday coaching, captain-rotation plans and booster strategy.",
};

export default function WcLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
