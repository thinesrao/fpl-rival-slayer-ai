"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = "loading" | "unsupported" | "off" | "on" | "blocked";

export function NotificationToggle({ teamId }: { teamId: number }) {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [unsupportedReason, setUnsupportedReason] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!VAPID_PUBLIC) {
      setUnsupportedReason("VAPID key missing on server build");
      setStatus("unsupported");
      return;
    }
    if (!("serviceWorker" in navigator)) {
      setUnsupportedReason("Service workers not available");
      setStatus("unsupported");
      return;
    }
    if (!("PushManager" in window)) {
      // Most common: iOS Safari (web push only works once installed as PWA on iOS 16.4+).
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      setUnsupportedReason(
        isIos
          ? "Install this app to your Home Screen first (iOS only enables push for installed PWAs)"
          : "This browser doesn't support web push",
      );
      setStatus("unsupported");
      return;
    }
    (async () => {
      // Wait for SW to actually register (PwaShell triggers it in parallel; race-safe).
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
      const sub = await reg.pushManager.getSubscription();
      if (sub) return setStatus("on");
      setStatus(Notification.permission === "denied" ? "blocked" : "off");
    })();
  }, []);

  if (status === "loading") return null;
  if (status === "unsupported") {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className="gap-1.5 text-xs"
        title={unsupportedReason}
      >
        <BellOff className="h-3.5 w-3.5" />
        Alerts unavailable
      </Button>
    );
  }

  const enable = async () => {
    if (!VAPID_PUBLIC) {
      toast.error("Push not configured (VAPID public key missing on server).");
      return;
    }
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "off");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC).buffer as ArrayBuffer,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId, subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error(`subscribe failed: ${res.status}`);
      setStatus("on");
      toast.success("Alerts enabled. We'll ping you for deadlines + injury news.");
    } catch (err) {
      console.warn("[push] enable failed", err);
      toast.error("Couldn't enable alerts. Check browser permissions.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      setStatus("off");
      toast.success("Alerts disabled.");
    } catch (err) {
      console.warn("[push] disable failed", err);
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/push/test?teamId=${teamId}`, { method: "POST" });
      if (!res.ok) throw new Error(`test failed: ${res.status}`);
      toast.success("Test push sent. Check your notifications.");
    } catch (err) {
      console.warn("[push] test failed", err);
      toast.error("Test failed — see browser console.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "blocked") {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1.5 text-xs">
        <BellOff className="h-3.5 w-3.5" />
        Alerts blocked
      </Button>
    );
  }
  if (status === "on") {
    return (
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={sendTest} disabled={busy} className="gap-1.5 text-xs">
          <Bell className="h-3.5 w-3.5 text-success" />
          Test
        </Button>
        <Button variant="ghost" size="sm" onClick={disable} disabled={busy} className="gap-1.5 text-xs">
          Mute
        </Button>
      </div>
    );
  }
  return (
    <Button variant="outline" size="sm" onClick={enable} disabled={busy} className="gap-1.5 text-xs">
      <Bell className="h-3.5 w-3.5" />
      Enable alerts
    </Button>
  );
}
