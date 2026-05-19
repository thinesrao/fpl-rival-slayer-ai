"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlayerPhoto } from "@/components/PlayerPhoto";
import { decodeDraft } from "@/lib/drafts/encode";
import { emptyDraft } from "@/lib/drafts/types";
import { loadDrafts, upsertDraft } from "@/lib/drafts/storage";
import { toast } from "sonner";

interface PlayerSummary {
  id: number;
  code: number;
  webName: string;
  team: string;
  price: number;
  position: number; // FPL element_type 1..4
  isCaptain: boolean;
  isVice: boolean;
}

interface Props {
  encoded: string;
  name: string;
  filled: number;
  totalCost: number;
  budget: number;
  players: PlayerSummary[];
}

const POS = ["?", "GKP", "DEF", "MID", "FWD"];

export function DraftImporter({ encoded, name, filled, totalCost, budget, players }: Props) {
  const [teamId, setTeamId] = useState<string>("");
  const [imported, setImported] = useState(false);

  // Default teamId to whatever the recipient most recently used (matches the
  // dashboard's localStorage key).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const recent = window.localStorage.getItem("fpl-rival-slayer:teamId");
      if (recent) setTeamId(recent);
    } catch {}
  }, []);

  const byPosition = useMemo(() => {
    const groups: Record<number, PlayerSummary[]> = { 1: [], 2: [], 3: [], 4: [] };
    for (const p of players) groups[p.position].push(p);
    return groups;
  }, [players]);

  const handleImport = () => {
    const t = Number(teamId);
    if (!Number.isFinite(t) || t <= 0) {
      toast.error("Enter your FPL team ID first.");
      return;
    }
    const decoded = decodeDraft(encoded);
    if (!decoded) {
      toast.error("Couldn't parse this draft. Ask the sender for a fresh link.");
      return;
    }
    const existing = loadDrafts(t);
    const fresh = emptyDraft(`${decoded.n} (imported)`);
    fresh.budget = decoded.b;
    fresh.picks = [...decoded.p];
    fresh.captainId = decoded.c;
    fresh.viceId = decoded.v;
    upsertDraft(t, fresh);
    setImported(true);
    try {
      window.localStorage.setItem("fpl-rival-slayer:teamId", String(t));
    } catch {}
    toast.success(`Imported "${fresh.name}" — open the Plan tab to tweak.`);
    void existing;
  };

  return (
    <div className="space-y-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3 w-3" /> Back to dashboard
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-xl">{name}</CardTitle>
              <CardDescription>
                Squad draft shared with you. Save it to your own drafts list to edit.
              </CardDescription>
            </div>
            <Badge variant={filled === 15 && totalCost <= budget ? "success" : "outline"}>
              {filled}/15 · £{totalCost.toFixed(1)}m
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {([1, 2, 3, 4] as const).map((etype) => (
            <div key={etype}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {POS[etype]}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {byPosition[etype].map((p) => (
                  <div
                    key={p.id}
                    className={`relative flex flex-col items-center gap-1 rounded-lg border bg-card p-2 ${p.isCaptain ? "ring-2 ring-amber-400" : p.isVice ? "ring-1 ring-slate-300" : ""}`}
                  >
                    <PlayerPhoto code={p.code} name={p.webName} size="md" />
                    {p.isCaptain && (
                      <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-amber-950">
                        C
                      </span>
                    )}
                    {p.isVice && !p.isCaptain && (
                      <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-900">
                        V
                      </span>
                    )}
                    <div className="w-full truncate text-center text-[11px] font-medium">{p.webName}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {p.team} · £{p.price.toFixed(1)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Save to your drafts</CardTitle>
          <CardDescription>
            Drafts are stored locally per FPL team. Pick your team ID and we&apos;ll add this as a
            copy you can edit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {imported ? (
            <div className="flex flex-col items-start gap-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <Check className="h-4 w-4" /> Imported. Open the Plan tab to edit it.
              </div>
              <Link href="/" className="text-xs underline">
                Go to dashboard
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="team-id" className="text-xs text-muted-foreground">
                Your FPL team ID
              </label>
              <input
                id="team-id"
                type="number"
                inputMode="numeric"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                placeholder="e.g. 123456"
                className="w-40 rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button size="sm" onClick={handleImport}>
                <Download className="mr-1 h-3.5 w-3.5" /> Save as new draft
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
