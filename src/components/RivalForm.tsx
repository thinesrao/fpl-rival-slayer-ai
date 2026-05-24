"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, Info, Loader2, Swords, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { PackReveal, type PackRevealManager } from "@/components/fut/PackReveal";

interface RecentTeam {
  teamId: number;
  leagueId: number;
  teamName: string;
  managerName: string;
  leagueName: string;
}

interface MiniLeagueOption {
  id: number;
  name: string;
  rank: number | null;
  size: number;
}

interface TeamPreview {
  team: { id: number; name: string; managerName: string; totalPoints: number; rank: number | null };
  miniLeagues: MiniLeagueOption[];
}

const RECENT_KEY = "fpl-rival-slayer:recent";
const RECENT_MAX = 5;

function readRecent(): RecentTeam[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is RecentTeam =>
        typeof r === "object" && r !== null &&
        typeof (r as RecentTeam).teamId === "number" &&
        typeof (r as RecentTeam).leagueId === "number" &&
        typeof (r as RecentTeam).teamName === "string" &&
        typeof (r as RecentTeam).managerName === "string",
      )
      .map((r) => ({ ...r, leagueName: r.leagueName ?? "" }))
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function writeRecent(list: RecentTeam[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // localStorage full or disabled — silently drop, the cookie still works.
  }
}

function upsertRecent(entry: RecentTeam): RecentTeam[] {
  const current = readRecent().filter(
    (r) => !(r.teamId === entry.teamId && r.leagueId === entry.leagueId),
  );
  const next = [entry, ...current].slice(0, RECENT_MAX);
  writeRecent(next);
  return next;
}

export function RivalForm() {
  const router = useRouter();
  const [teamId, setTeamId] = useState("");
  const [status, setStatus] = useState<"idle" | "validating" | "preview" | "confirming" | "reveal">("idle");
  const [preview, setPreview] = useState<TeamPreview | null>(null);
  const [pickedLeagueId, setPickedLeagueId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentTeam[]>([]);
  const [revealManager, setRevealManager] = useState<PackRevealManager | null>(null);
  const [pendingPush, setPendingPush] = useState<string | null>(null);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  async function runValidate(t: number) {
    setStatus("validating");
    setError(null);
    try {
      const res = await fetch(`/api/validate-team?teamId=${t}`);
      const json = (await res.json()) as
        | { ok: true; team: TeamPreview["team"]; miniLeagues: MiniLeagueOption[] }
        | { ok: false; error: string; message: string };
      if (!json.ok) {
        setError(json.message);
        setStatus("idle");
        return;
      }
      if (json.miniLeagues.length === 0) {
        setError(
          "This team isn't in any invitational mini-leagues yet. Join one on fantasy.premierleague.com first.",
        );
        setStatus("idle");
        return;
      }
      setPreview({ team: json.team, miniLeagues: json.miniLeagues });
      setPickedLeagueId(json.miniLeagues[0].id);
      setStatus("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed. Try again.");
      setStatus("idle");
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = Number(teamId);
    if (!Number.isInteger(t) || t <= 0) {
      toast.error("Enter a valid FPL Team ID (an integer).");
      return;
    }
    void runValidate(t);
  }

  async function onConfirm() {
    if (!preview || pickedLeagueId === null) return;
    const pickedLeague = preview.miniLeagues.find((l) => l.id === pickedLeagueId);
    if (!pickedLeague) return;
    setStatus("confirming");
    try {
      const res = await fetch("/api/auth/set-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: preview.team.id, leagueId: pickedLeague.id }),
      });
      const json = (await res.json()) as { ok: boolean; message?: string };
      if (!json.ok) {
        setError(json.message || "Could not save your team. Try again.");
        setStatus("preview");
        return;
      }
      setRecent(
        upsertRecent({
          teamId: preview.team.id,
          leagueId: pickedLeague.id,
          teamName: preview.team.name,
          managerName: preview.team.managerName,
          leagueName: pickedLeague.name,
        }),
      );
      setRevealManager({
        name: preview.team.name,
        managerName: preview.team.managerName,
        totalPoints: preview.team.totalPoints,
        overallRank: preview.team.rank,
        leagueName: pickedLeague.name,
        leagueRank: pickedLeague.rank,
        leagueSize: pickedLeague.size,
      });
      setPendingPush(`/dashboard/${preview.team.id}/${pickedLeague.id}`);
      setStatus("reveal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Try again.");
      setStatus("preview");
    }
  }

  function onReset() {
    setStatus("idle");
    setPreview(null);
    setPickedLeagueId(null);
    setError(null);
  }

  function onPickRecent(r: RecentTeam) {
    setTeamId(String(r.teamId));
    setError(null);
    void runValidate(r.teamId);
  }

  function onRemoveRecent(target: { teamId: number; leagueId: number }, e: React.MouseEvent) {
    e.stopPropagation();
    const next = readRecent().filter(
      (r) => !(r.teamId === target.teamId && r.leagueId === target.leagueId),
    );
    writeRecent(next);
    setRecent(next);
  }

  if (status === "reveal" && revealManager && pendingPush) {
    return (
      <PackReveal
        manager={revealManager}
        onDone={() => router.push(pendingPush)}
      />
    );
  }

  if ((status === "preview" || status === "confirming") && preview) {
    return (
      <div className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6 shadow-lg">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Use a different Team ID
        </button>
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
            {initials(preview.team.managerName)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{preview.team.name}</p>
            <p className="truncate text-sm text-muted-foreground">{preview.team.managerName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {preview.team.totalPoints.toLocaleString()} pts
              {preview.team.rank ? ` · overall rank #${preview.team.rank.toLocaleString()}` : ""}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Pick a mini-league
          </p>
          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border bg-background/40 p-1.5">
            {preview.miniLeagues.map((l) => {
              const selected = l.id === pickedLeagueId;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setPickedLeagueId(l.id)}
                  className={
                    "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition " +
                    (selected
                      ? "border-primary bg-primary/10"
                      : "border-transparent hover:border-border hover:bg-muted/40")
                  }
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Trophy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{l.name}</span>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {l.rank ? `#${l.rank.toLocaleString()}` : "—"} / {l.size.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button onClick={onConfirm} size="lg" className="w-full" disabled={status === "confirming" || pickedLeagueId === null}>
          {status === "confirming" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading dashboard…
            </>
          ) : (
            <>
              <Swords className="mr-2 h-4 w-4" /> Slay my rivals
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-6 shadow-lg"
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="teamId">FPL Team ID</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Where do I find this?" className="text-muted-foreground hover:text-foreground">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Log in to fantasy.premierleague.com, click your team name in the top nav. The number in the URL
                (<span className="font-mono">/entry/1234567/</span>) is your team ID.
              </TooltipContent>
            </Tooltip>
          </div>
          <Input
            id="teamId"
            inputMode="numeric"
            placeholder="e.g. 1234567"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value.replace(/[^0-9]/g, ""))}
            required
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            We&apos;ll pull your mini-leagues so you can pick which one to track.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={status === "validating"}>
          {status === "validating" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking…
            </>
          ) : (
            <>
              <Swords className="mr-2 h-4 w-4" /> Continue
            </>
          )}
        </Button>

        {recent.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Recent</p>
            <div className="flex flex-wrap gap-2">
              {recent.map((r) => (
                <div
                  key={`${r.teamId}.${r.leagueId}`}
                  className="group inline-flex max-w-full items-center gap-2 rounded-full border bg-background/50 py-1.5 pl-3 pr-1 text-xs hover:border-primary hover:bg-primary/5"
                >
                  <button
                    type="button"
                    onClick={() => onPickRecent(r)}
                    disabled={status === "validating"}
                    className="inline-flex min-w-0 items-center gap-2"
                    title={`${r.teamName} — ${r.leagueName || "league"}`}
                  >
                    <span className="truncate font-medium">{r.teamName}</span>
                    {r.leagueName && (
                      <span className="truncate text-muted-foreground">· {r.leagueName}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${r.teamName}`}
                    onClick={(e) => onRemoveRecent({ teamId: r.teamId, leagueId: r.leagueId }, e)}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </form>
    </TooltipProvider>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
