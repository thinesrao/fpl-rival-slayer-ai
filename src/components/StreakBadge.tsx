"use client";

import { useQuery } from "@tanstack/react-query";

interface Props {
  teamId: number;
}

interface StreakResponse {
  count: number;
  average: number;
  sample: number;
  currentGwNet: number;
}

/** Small inline chip — flame icon + consecutive-GW streak count.
 *  Hidden when the streak is 0 or data isn't loaded yet. Pure CSS
 *  flicker animation (no JS) keeps this dirt-cheap. */
export function StreakBadge({ teamId }: Props) {
  const q = useQuery({
    queryKey: ["streak", teamId],
    queryFn: async (): Promise<StreakResponse> => {
      const res = await fetch(`/api/streak?teamId=${teamId}`);
      if (!res.ok) throw new Error(`streak ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  const data = q.data;
  if (!data || data.count === 0) return null;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-300"
      title={`${data.count} GWs in a row above your season average of ${data.average} pts (${data.sample} GWs played).`}
    >
      <span className="streak-flame">🔥</span>
      <span className="font-mono">{data.count}</span>
      <span className="text-[10px] font-medium opacity-80">streak</span>
    </span>
  );
}
