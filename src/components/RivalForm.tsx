"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { defaults } from "@/lib/env";
import { ArrowLeft, Info, Loader2, Swords, Trophy, X } from "lucide-react";
import { toast } from "sonner";

interface RecentTeam {
  teamId: number;
  leagueId: number;
  teamName: string;
  managerName: string;
}

interface TeamPreview {
  team: { id: number; name: string; managerName: string; totalPoints: number; rank: number | null };
  league: { id: number; name: string };
  leagueMembershipChecked: boolean;
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
  const current = readRecent().filter((r) => r.teamId !== entry.teamId);
  const next = [entry, ...current].slice(0, RECENT_MAX);
  writeRecent(next);
  return next;
}

export function RivalForm() {
  const router = useRouter();
  const [teamId, setTeamId] = useState(defaults.teamId ? String(defaults.teamId) : "");
  const [leagueId, setLeagueId] = useState(defaults.leagueId ? String(defaults.leagueId) : "");
  const [status, setStatus] = useState<"idle" | "validating" | "preview" | "confirming">("idle");
  const [preview, setPreview] = useState<TeamPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentTeam[]>([]);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  async function runValidate(t: number, l: number) {
    setStatus("validating");
    setError(null);
    try {
      const res = await fetch(`/api/validate-team?teamId=${t}&leagueId=${l}`);
      const json = (await res.json()) as
        | { ok: true; team: TeamPreview["team"]; league: TeamPreview["league"]; leagueMembershipChecked: boolean }
        | { ok: false; error: string; message: string };
      if (!json.ok) {
        setError(json.message);
        setStatus("idle");
        return;
      }
      setPreview({
        team: json.team,
        league: json.league,
        leagueMembershipChecked: json.leagueMembershipChecked,
      });
      setStatus("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed. Try again.");
      setStatus("idle");
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = Number(teamId);
    const l = Number(leagueId);
    if (!Number.isInteger(t) || t <= 0) {
      toast.error("Enter a valid FPL Team ID (an integer).");
      return;
    }
    if (!Number.isInteger(l) || l <= 0) {
      toast.error("Enter a valid Mini-League ID (an integer).");
      return;
    }
    void runValidate(t, l);
  }

  async function onConfirm() {
    if (!preview) return;
    setStatus("confirming");
    try {
      const res = await fetch("/api/auth/set-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: preview.team.id, leagueId: preview.league.id }),
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
          leagueId: preview.league.id,
          teamName: preview.team.name,
          managerName: preview.team.managerName,
        }),
      );
      router.push(`/dashboard/${preview.team.id}/${preview.league.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Try again.");
      setStatus("preview");
    }
  }

  function onReset() {
    setStatus("idle");
    setPreview(null);
    setError(null);
  }

  function onPickRecent(r: RecentTeam) {
    setTeamId(String(r.teamId));
    setLeagueId(String(r.leagueId));
    setError(null);
    void runValidate(r.teamId, r.leagueId);
  }

  function onRemoveRecent(teamIdToRemove: number, e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    const next = readRecent().filter((r) => r.teamId !== teamIdToRemove);
    writeRecent(next);
    setRecent(next);
  }

  if ((status === "preview" || status === "confirming") && preview) {
    return (
      <div className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6 shadow-lg">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Use different ID
        </button>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
              {initials(preview.team.managerName)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{preview.team.name}</p>
              <p className="truncate text-sm text-muted-foreground">{preview.team.managerName}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {preview.team.totalPoints.toLocaleString()} pts
                {preview.team.rank ? ` · league rank #${preview.team.rank}` : ""}
              </p>
            </div>
          </div>
          <div className="rounded-md border bg-background/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <Trophy className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate text-sm">{preview.league.name}</span>
            </div>
            {!preview.leagueMembershipChecked && (
              <p className="mt-1 text-xs text-muted-foreground">
                Couldn&apos;t verify membership on page 1 of standings — if this team isn&apos;t in this league, the dashboard will show empty data.
              </p>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button onClick={onConfirm} size="lg" className="w-full" disabled={status === "confirming"}>
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
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="leagueId">Mini-League ID</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Where do I find this?" className="text-muted-foreground hover:text-foreground">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Open your mini-league standings page. The trailing number in the URL
                (<span className="font-mono">/leagues/12345/standings/c</span>) is your league ID.
              </TooltipContent>
            </Tooltip>
          </div>
          <Input
            id="leagueId"
            inputMode="numeric"
            placeholder="e.g. 314"
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value.replace(/[^0-9]/g, ""))}
            required
          />
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
              <Swords className="mr-2 h-4 w-4" /> Slay my rivals
            </>
          )}
        </Button>

        {recent.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Recent teams</p>
            <div className="flex flex-wrap gap-2">
              {recent.map((r) => (
                <div
                  key={r.teamId}
                  className="group inline-flex max-w-full items-center gap-2 rounded-full border bg-background/50 pl-3 pr-1 py-1.5 text-xs hover:border-primary hover:bg-primary/5"
                >
                  <button
                    type="button"
                    onClick={() => onPickRecent(r)}
                    disabled={status === "validating"}
                    className="inline-flex min-w-0 items-center gap-2"
                  >
                    <span className="truncate font-medium">{r.teamName}</span>
                    <span className="truncate text-muted-foreground">{r.managerName}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${r.teamName}`}
                    onClick={(e) => onRemoveRecent(r.teamId, e)}
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
