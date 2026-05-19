"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import { encodeDraft } from "@/lib/drafts/encode";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DraftEditor } from "@/components/DraftEditor";
import { emptyDraft, type PickerPlayer, type SquadDraft } from "@/lib/drafts/types";
import { deleteDraft, loadDrafts } from "@/lib/drafts/storage";
import { validateDraft } from "@/lib/drafts/validate";

interface Props {
  teamId: number;
}

export function DraftsPanel({ teamId }: Props) {
  const [drafts, setDrafts] = useState<SquadDraft[]>([]);
  const [editing, setEditing] = useState<SquadDraft | null>(null);

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

  const createDraft = () => {
    const next = emptyDraft(`Draft ${String.fromCharCode(65 + drafts.length)}`);
    setEditing(next);
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
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4 text-primary" /> Squad drafts
          </CardTitle>
          <CardDescription>
            Sketch alternative XIs within your budget. Saved locally — review across the week, pick one before the deadline.
          </CardDescription>
        </div>
        <Button size="sm" onClick={createDraft}>
          <Plus className="mr-1 h-4 w-4" /> New draft
        </Button>
      </CardHeader>
      <CardContent>
        {drafts.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            No drafts yet. Tap <strong>New draft</strong> to sketch your first squad — no FPL login needed.
          </p>
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
    </Card>
  );
}
