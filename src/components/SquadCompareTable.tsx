"use client";

import type { ManagerSquad, PlayerProjection, Position, SquadProjection } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const POSITIONS: Position[] = ["GKP", "DEF", "MID", "FWD"];

interface Props {
  user: ManagerSquad;
  userProjection: SquadProjection;
  rivals: ManagerSquad[];
  rivalProjections: SquadProjection[];
}

function projByPlayer(proj: SquadProjection) {
  return new Map(proj.perPlayer.map((p) => [p.playerId, p]));
}

function slotsByPosition(squad: ManagerSquad, pos: Position) {
  return squad.picks
    .filter((s) => s.position === pos)
    .sort((a, b) => a.pick.position - b.pick.position);
}

function PlayerCell({
  name,
  proj,
  isCaptain,
  isVice,
  benched,
  team,
}: {
  name: string;
  proj: PlayerProjection | undefined;
  isCaptain: boolean;
  isVice: boolean;
  benched: boolean;
  team: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5 rounded-md p-2", benched ? "opacity-50" : "")}>
      <div className="flex items-center gap-1">
        <span className="truncate text-sm font-medium">{name}</span>
        {isCaptain && (
          <Badge className="px-1 py-0 text-[10px]" variant="success">C</Badge>
        )}
        {isVice && (
          <Badge className="px-1 py-0 text-[10px]" variant="secondary">V</Badge>
        )}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{team}</span>
        {proj && <span>xP {proj.xPoints.toFixed(1)}</span>}
        {proj && proj.injuryRisk > 0.25 && (
          <Badge variant="destructive" className="px-1 py-0 text-[10px]">
            {Math.round(proj.injuryRisk * 100)}% injury
          </Badge>
        )}
      </div>
    </div>
  );
}

export function SquadCompareTable({ user, userProjection, rivals, rivalProjections }: Props) {
  const userMap = projByPlayer(userProjection);
  const rivalMaps = rivalProjections.map(projByPlayer);
  const cols = [user, ...rivals];
  const projMaps = [userMap, ...rivalMaps];

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[720px]">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-muted-foreground">
            <th className="px-4 py-3">Position</th>
            {cols.map((c, i) => (
              <th key={c.entry.id} className="px-3 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground">
                    {i === 0 ? "You" : `Rival #${i}`}
                  </span>
                  <span className="truncate text-xs font-normal normal-case text-muted-foreground">
                    {c.entry.name} · rank {c.entry.rank}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {POSITIONS.map((pos) => {
            const maxRows = Math.max(...cols.map((c) => slotsByPosition(c, pos).length));
            return Array.from({ length: maxRows }).map((_, rowIdx) => (
              <tr key={`${pos}-${rowIdx}`} className="border-b last:border-0">
                {rowIdx === 0 && (
                  <td rowSpan={maxRows} className="border-r px-4 py-2 align-top text-xs font-semibold text-muted-foreground">
                    {pos}
                  </td>
                )}
                {cols.map((c, colIdx) => {
                  const slots = slotsByPosition(c, pos);
                  const slot = slots[rowIdx];
                  if (!slot) return <td key={colIdx} className="px-3 py-2" />;
                  const proj = projMaps[colIdx].get(slot.player.id);
                  return (
                    <td key={colIdx} className="px-3 py-1">
                      <PlayerCell
                        name={slot.player.web_name}
                        proj={proj}
                        isCaptain={slot.pick.is_captain}
                        isVice={slot.pick.is_vice_captain}
                        benched={slot.pick.multiplier === 0}
                        team={slot.team.short_name}
                      />
                    </td>
                  );
                })}
              </tr>
            ));
          })}
          <tr className="bg-muted/40 font-semibold">
            <td className="px-4 py-3 text-xs uppercase text-muted-foreground">Projected XI</td>
            {cols.map((_, i) => (
              <td key={i} className="px-3 py-3 text-sm">
                {(i === 0 ? userProjection : rivalProjections[i - 1]).startingXIPoints.toFixed(1)} pts
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
