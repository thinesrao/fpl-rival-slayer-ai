"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check, Loader2, LogOut, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MiniLeagueOption {
  id: number;
  name: string;
  rank: number | null;
  size: number;
}

interface Props {
  teamId: number;
  leagueId: number;
}

export function LeagueSwitcher({ teamId, leagueId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [leagues, setLeagues] = useState<MiniLeagueOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || leagues !== null) return;
    setLoading(true);
    setError(null);
    fetch(`/api/leagues?teamId=${teamId}`)
      .then((r) => r.json())
      .then((json: { ok: true; miniLeagues: MiniLeagueOption[] } | { ok: false; message: string }) => {
        if (!json.ok) {
          setError(json.message);
          return;
        }
        setLeagues(json.miniLeagues);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load leagues"))
      .finally(() => setLoading(false));
  }, [open, leagues, teamId]);

  async function switchToLeague(newLeagueId: number) {
    if (newLeagueId === leagueId) {
      setOpen(false);
      return;
    }
    setSwitchingTo(newLeagueId);
    try {
      const res = await fetch("/api/auth/set-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, leagueId: newLeagueId }),
      });
      const json = (await res.json()) as { ok: boolean; message?: string };
      if (!json.ok) {
        setError(json.message || "Could not switch leagues.");
        setSwitchingTo(null);
        return;
      }
      router.push(`/dashboard/${teamId}/${newLeagueId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSwitchingTo(null);
    }
  }

  async function useDifferentTeam() {
    try {
      await fetch("/api/auth/clear", { method: "POST" });
    } catch {
      // Best-effort
    }
    router.push("/");
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        aria-label="Switch league or team"
        title="Switch league"
        onClick={() => setOpen((o) => !o)}
        className="h-8 w-8 px-0 sm:h-9 sm:w-auto sm:px-3"
      >
        <ArrowRightLeft className="h-4 w-4" />
        <span className="ml-1.5 hidden sm:inline">Switch</span>
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg">
          <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Switch mini-league
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading your leagues…
              </div>
            )}
            {error && (
              <div className="px-3 py-2 text-sm text-destructive">{error}</div>
            )}
            {leagues && leagues.length === 0 && (
              <div className="px-3 py-3 text-sm text-muted-foreground">
                No invitational mini-leagues found.
              </div>
            )}
            {leagues &&
              leagues.map((l) => {
                const current = l.id === leagueId;
                const switching = switchingTo === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => switchToLeague(l.id)}
                    disabled={switchingTo !== null}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-muted/60",
                      current && "bg-primary/5",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {current ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                      ) : switching ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <Trophy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{l.name}</span>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {l.rank ? `#${l.rank.toLocaleString()}` : "—"} / {l.size.toLocaleString()}
                    </span>
                  </button>
                );
              })}
          </div>
          <div className="border-t">
            <button
              type="button"
              onClick={useDifferentTeam}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Use a different team
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
