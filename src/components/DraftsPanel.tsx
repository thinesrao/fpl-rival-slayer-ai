"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, ClipboardList, KeyRound, Loader2, Pencil, Plus, Share2, Trash2, Wand2 } from "lucide-react";
import { encodeDraft } from "@/lib/drafts/encode";
import { CompareDrafts } from "@/components/CompareDrafts";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DraftEditor } from "@/components/DraftEditor";
import { FplSquadImport } from "@/components/FplSquadImport";
import { ModelTrustBadge } from "@/components/ModelTrustBadge";
import type { DraftSeed } from "@/lib/drafts/seed";
import { emptyDraft, type PickerPlayer, type SquadDraft } from "@/lib/drafts/types";
import { deleteDraft, loadDrafts } from "@/lib/drafts/storage";
import { validateDraft } from "@/lib/drafts/validate";

/** /api/wildcard returns a DraftSeed plus a note on how it was solved. */
interface WildcardSeed extends DraftSeed {
  optimiser: {
    source: "fpl" | "model";
    method: "search" | "exact";
    approximate: boolean;
    horizon: number[];
    startingXp: number;
    spentOfBudget: number;
    candidatesSearched: number;
    candidatesConsidered: number;
  };
}

interface Props {
  teamId: number;
}

export function DraftsPanel({ teamId }: Props) {
  const [drafts, setDrafts] = useState<SquadDraft[]>([]);
  const [editing, setEditing] = useState<SquadDraft | null>(null);
  const [comparing, setComparing] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [wildcardLoading, setWildcardLoading] = useState(false);
  const [wildcard, setWildcard] = useState<WildcardSeed["optimiser"] | null>(null);

  useEffect(() => {
    setDrafts(loadDrafts(teamId));
  }, [teamId]);

  const playersQ = useQuery({
    queryKey: ["players"],
    queryFn: async () => {
      const res = await fetch("/api/players");
      if (!res.ok) throw new Error(`players ${res.status}`);
      return (await res.json()) as { players: PickerPlayer[] };
    },
    staleTime: 10 * 60 * 1000,
  });
  const byId = new Map<number, PickerPlayer>();
  playersQ.data?.players.forEach((p) => byId.set(p.id, p));

  /** Turn a seeded squad into an unsaved draft and open the editor on it. */
  const openSeededDraft = (seed: DraftSeed, name: string) => {
    const next = emptyDraft(name);
    next.budget = seed.budget;
    next.picks = seed.picks;
    next.captainId = seed.captainId;
    next.viceId = seed.viceId;
    next.startingXI = seed.startingXI;
    next.formation = seed.formation;
    setEditing(next);
  };

  const createDraft = async () => {
    setSeedLoading(true);
    try {
      const res = await fetch(`/api/my-squad-draft-seed?teamId=${teamId}`);
      const body = await res.json();
      if (!res.ok) {
        toast.error(body?.message ?? "Couldn't load your current squad.");
        // Fall back to an empty draft so the user can still try.
        setEditing(emptyDraft(`Draft ${String.fromCharCode(65 + drafts.length)}`));
        return;
      }
      const seed = body as DraftSeed;
      openSeededDraft(seed, `GW${seed.gw + 1} draft ${String.fromCharCode(65 + drafts.length)}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSeedLoading(false);
    }
  };

  const suggestWildcard = async () => {
    setWildcardLoading(true);
    try {
      const res = await fetch(`/api/wildcard?teamId=${teamId}`);
      const body = await res.json();
      if (!res.ok) {
        toast.error(body?.message ?? `Couldn't build a wildcard squad (${res.status})`);
        return;
      }
      const seed = body as WildcardSeed;
      setWildcard(seed.optimiser);
      openSeededDraft(seed, `GW${seed.gw} wildcard (suggested)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setWildcardLoading(false);
    }
  };

  const handleImported = (seed: DraftSeed) => {
    const chip = seed.activeChip
      ? seed.activeChip.replace("freehit", "free hit").replace("3xc", "triple captain")
      : null;
    openSeededDraft(seed, `GW${seed.gw}${chip ? ` ${chip}` : ""} squad`);
    setImporting(false);
    toast.success(
      chip
        ? `Imported your GW${seed.gw} ${chip} squad — roast it before the deadline.`
        : `Imported your saved GW${seed.gw} squad.`,
    );
  };

  const handleSaved = () => {
    setDrafts(loadDrafts(teamId));
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this draft? This can't be undone.")) return;
    setDrafts(deleteDraft(teamId, id));
  };

  const handleShare = async (d: SquadDraft) => {
    const url = `${window.location.origin}/draft/${encodeDraft(d)}`;
    if (navigator.share) {
      try { await navigator.share({ title: `${d.name} — FPL draft`, url }); return; }
      catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast.success("Link copied"); window.open(url, "_blank", "noopener"); }
    catch { window.open(url, "_blank", "noopener"); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 font-display text-base uppercase tracking-tight">
            <ClipboardList className="h-4 w-4 text-fut-gold" /> Draft
          </CardTitle>
          <CardDescription>
            Each new draft starts from your latest locked-in squad and bank balance. Make
            transfers, change formation, swap captain — save as many what-if scenarios as you like,
            then pick one before the deadline. Already picked a squad in the FPL app (a wildcard,
            say)? <strong>Import saved</strong> pulls it in before the deadline locks it.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          {drafts.length >= 2 && (
            <Button size="sm" variant="outline" onClick={() => setComparing(true)}>
              <ArrowLeftRight className="mr-1 h-4 w-4" /> Compare
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
            <KeyRound className="mr-1 h-4 w-4" /> Import saved
          </Button>
          <Button size="sm" variant="outline" onClick={suggestWildcard} disabled={wildcardLoading}>
            {wildcardLoading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="mr-1 h-4 w-4 text-fut-gold" />
            )}
            {wildcardLoading ? "Optimising…" : "Suggest wildcard"}
          </Button>
          <Button size="sm" onClick={createDraft} disabled={seedLoading}>
            {seedLoading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            {seedLoading ? "Loading squad…" : "New draft"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {wildcard && (
          <div className="mb-3 rounded-md border border-fut-gold/30 bg-fut-gold/5 p-3 text-[11px] leading-relaxed">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-display text-xs font-semibold uppercase tracking-tight">
                Suggested wildcard
              </span>
              <Badge variant="outline" className="font-mono">
                {wildcard.startingXp.toFixed(1)} xPts
              </Badge>
              <Badge variant="outline" className="font-mono">
                £{(wildcard.spentOfBudget / 10).toFixed(1)}m spent
              </Badge>
              {/* The badge discloses that *our* model trails FPL's published
                  xP. It has nothing to say about a suggestion built from
                  FPL's own numbers, where the copy below is the disclosure. */}
              {wildcard.source === "model" && <ModelTrustBadge />}
            </div>
            <p className="text-muted-foreground">
              {wildcard.approximate ? "Near-best" : "Best"} legal 15 for GW{wildcard.horizon[0]},
              picked from {wildcard.candidatesSearched} shortlisted out of{" "}
              {wildcard.candidatesConsidered} players and weighing GW
              {wildcard.horizon[0]}&ndash;{wildcard.horizon[wildcard.horizon.length - 1]} with the
              nearest week counting most. Expected points come from{" "}
              {wildcard.source === "fpl" ? "FPL's own published projection" : "this app's model"}.
              It&apos;s a starting point, not a verdict &mdash; edit it and run the roast.
            </p>
          </div>
        )}
        {drafts.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No drafts yet. Tap <strong>New draft</strong> to clone your current squad and start
              planning next gameweek.
            </p>
          </div>
        ) : (
          <ul className="divide-y rounded-md border">
            {drafts.map((d) => {
              const v = validateDraft(d, byId);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{d.name}</span>
                      {v.ok ? (
                        <Badge variant="success" className="px-1.5 py-0 text-[9px] leading-none">valid</Badge>
                      ) : (
                        <Badge variant="outline" className="px-1.5 py-0 text-[9px] leading-none">{v.filled}/15</Badge>
                      )}
                      {!v.inBudget && (
                        <Badge variant="destructive" className="px-1.5 py-0 text-[9px] leading-none">over budget</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      £{v.totalCost.toFixed(1)}m / £{(d.budget / 10).toFixed(1)}m · updated {new Date(d.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(d)} className="h-8 px-2">
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleShare(d)}
                      aria-label="Share draft"
                      className="h-8 px-2"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(d.id)}
                      aria-label="Delete draft"
                      className="h-8 px-2 text-muted-foreground hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {editing && (
        <DraftEditor
          teamId={teamId}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {comparing && (
        <CompareDrafts drafts={drafts} onClose={() => setComparing(false)} />
      )}

      <FplSquadImport
        open={importing}
        teamId={teamId}
        onClose={() => setImporting(false)}
        onImported={handleImported}
      />
    </Card>
  );
}
