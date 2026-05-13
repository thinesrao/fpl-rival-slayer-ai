"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

// Combined: registers the service worker on mount AND shows an install prompt
// when the browser fires `beforeinstallprompt`. Lives in one component so we
// only mount one client island.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "rival-slayer:install-dismissed";

export function PwaShell() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[pwa] sw register failed", err);
      });
    }

    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");

    const onBefore = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      localStorage.setItem(DISMISS_KEY, "1");
    };
    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferred || dismissed) return null;

  const install = async () => {
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") {
      setDeferred(null);
    }
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="fixed inset-x-2 bottom-2 z-50 mx-auto flex max-w-sm items-center gap-2 rounded-lg border bg-card/95 p-3 shadow-lg backdrop-blur sm:left-auto sm:right-4 sm:mx-0">
      <Download className="h-4 w-4 shrink-0 text-primary" />
      <div className="flex-1 text-xs">
        <div className="font-medium">Install Rival Slayer</div>
        <div className="text-muted-foreground">Add to your home screen for one-tap access and deadline alerts.</div>
      </div>
      <Button size="sm" onClick={install}>Install</Button>
      <Button size="icon" variant="ghost" aria-label="Dismiss" onClick={dismiss} className="h-7 w-7">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
