"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    if (loading) return;
    setLoading(true);
    try {
      await fetch("/api/auth/clear", { method: "POST" });
    } catch {
      // Best-effort — even on a network error we still want to drop the user
      // back at the onboarding form.
    }
    router.push("/");
  }

  return (
    <Button
      variant="outline"
      size="sm"
      aria-label="Log out (change FPL ID)"
      title="Log out"
      onClick={logout}
      disabled={loading}
      className="h-8 w-8 px-0 sm:h-9 sm:w-auto sm:px-3"
    >
      <LogOut className="h-4 w-4" />
      <span className="ml-1.5 hidden sm:inline">{loading ? "…" : "Log out"}</span>
    </Button>
  );
}
