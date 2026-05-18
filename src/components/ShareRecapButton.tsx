"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props {
  teamId: number;
  gw: number;
  /** Optional team name for the share caption. */
  teamName?: string;
}

/** Builds the absolute URL to the OG-image share card and triggers the
 *  best-available share path:
 *    - mobile w/ Web Share API → navigator.share()
 *    - else → copy URL to clipboard + open in a new tab as a preview.
 */
export function ShareRecapButton({ teamId, gw, teamName }: Props) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined"
    ? `${window.location.origin}/api/og/recap?teamId=${teamId}&gw=${gw}`
    : "";

  const handle = async () => {
    if (!url) return;
    const text = teamName ? `${teamName} — GW ${gw} recap` : `GW ${gw} recap`;
    // Web Share API: pass the URL so messaging apps unfurl the OG image.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: text, text, url });
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return; // user dismissed
        // Fall through to clipboard if share rejected for any other reason.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Share link copied — paste into your group chat.");
      window.open(url, "_blank", "noopener");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.open(url, "_blank", "noopener");
    }
  };

  return (
    <Button
      type="button"
      onClick={handle}
      size="sm"
      variant="outline"
      className="gap-1.5"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Share recap"}
    </Button>
  );
}
