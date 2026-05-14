"use client";

import { useQuery } from "@tanstack/react-query";
import { Award, ChevronRight, Flame, Shield } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type ChipName = "wildcard" | "wildcard2" | "freehit" | "bboost" | "3xc";

interface ChipStatus {
  used: Array<{ chip: ChipName; gw: number }>;
  remaining: ChipName[];
  hint: string;
  hintRisk: "low" | "medium" | "high";
}

interface ChipsResponse {
  targetGw: number;
  horizonGws: number[];
  user: { entryId: number; name: string; activeChip: string | null; status: ChipStatus };
  rivals: Array<{
    entryId: number;
    name: string;
    playerName: string;
    activeChip: string | null;
    status: ChipStatus;
  }>;
}

interface Props {
  teamId: number;
  leagueId: number;
}

const CHIP_LABEL: Record<ChipName, string> = {
  wildcard: "WC1",
  wildcard2: "WC2",
  freehit: "FH",
  bboost: "BB",
  "3xc": "TC",
};

const ALL_ORDER: ChipName[] = ["wildcard", "wildcard2", "freehit", "bboost", "3xc"];

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function RivalChipsPanel({ teamId, leagueId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["chips", teamId, leagueId],
    queryFn: () => fetchJson<ChipsResponse>(`/api/chips?teamId=${teamId}&leagueId=${leagueId}`),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load chip status</AlertTitle>
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  if (!data) return null;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-primary" /> Chip wallet
          </CardTitle>
          <CardDescription>
            What you and the rivals above you still have to play in the season. Hint heuristics look at the next 3 GWs for DGW/BGW pressure.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ChipRow label="You" name={data.user.name} status={data.user.status} activeChip={data.user.activeChip} youOwn />
          {data.rivals.map((r) => (
            <ChipRow
              key={r.entryId}
              label={`vs ${r.name}`}
              name={r.playerName}
              status={r.status}
              activeChip={r.activeChip}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ChipRow({
  label,
  name,
  status,
  activeChip,
  youOwn,
}: {
  label: string;
  name: string;
  status: ChipStatus;
  activeChip: string | null;
  youOwn?: boolean;
}) {
  const usedMap = new Map(status.used.map((u) => [u.chip, u.gw]));
  const remainingSet = new Set(status.remaining);
  const risk = status.hintRisk;
  return (
    <div className={cn("rounded-md border p-3", youOwn && "bg-primary/5 border-primary/40")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{label}</div>
          <div className="text-[11px] text-muted-foreground">{name}</div>
        </div>
        {activeChip && (
          <Badge variant="success" className="px-1.5 py-0 text-[10px]">
            <Flame className="mr-1 h-2.5 w-2.5" />
            {activeChip} active
          </Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {ALL_ORDER.map((chip) => {
          const used = usedMap.has(chip);
          const remaining = remainingSet.has(chip);
          return (
            <Badge
              key={chip}
              variant={remaining ? "outline" : "secondary"}
              title={used ? `Used GW${usedMap.get(chip)}` : "Remaining"}
              className={cn(
                "px-1.5 py-0 text-[10px]",
                used && "line-through opacity-50",
                remaining && "border-emerald-500/40",
              )}
            >
              {CHIP_LABEL[chip]}
              {used && <span className="ml-1 text-[9px]">GW{usedMap.get(chip)}</span>}
            </Badge>
          );
        })}
      </div>
      <div className="mt-2 flex items-start gap-1.5 text-[11px]">
        <Award
          className={cn(
            "mt-0.5 h-3 w-3 shrink-0",
            risk === "high" ? "text-rose-500" : risk === "medium" ? "text-amber-500" : "text-muted-foreground",
          )}
        />
        <div>
          <span
            className={cn(
              "font-medium",
              risk === "high" ? "text-rose-500" : risk === "medium" ? "text-amber-500" : "text-foreground",
            )}
          >
            {status.hint}
          </span>
          {risk !== "low" && (
            <span className="ml-1 text-muted-foreground">
              <ChevronRight className="inline h-3 w-3" />
              {risk} risk
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
