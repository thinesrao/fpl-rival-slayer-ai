"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Swords } from "lucide-react";
import { toast } from "sonner";

export function RivalForm() {
  const router = useRouter();
  const [teamId, setTeamId] = useState("");
  const [leagueId, setLeagueId] = useState("");
  const [loading, setLoading] = useState(false);

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
    setLoading(true);
    router.push(`/dashboard/${t}/${l}`);
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

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          <Swords className="mr-2 h-4 w-4" />
          {loading ? "Loading..." : "Slay my rivals"}
        </Button>
      </form>
    </TooltipProvider>
  );
}
