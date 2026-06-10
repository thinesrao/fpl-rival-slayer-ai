"use client";

// Live countdown to the next round lock. Re-renders every second; compact
// digits in mono font with the WC stripe underneath.

import { useEffect, useState } from "react";

export function WcCountdown({ lockIso, label }: { lockIso: string; label?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ms = new Date(lockIso).getTime() - now;
  if (ms <= 0) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-sm font-bold text-emerald-300">
        ● ROUND LOCKED — LIVE
      </div>
    );
  }

  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const parts = [
    ...(d > 0 ? [[d, "d"]] : []),
    [h, "h"],
    [m, "m"],
    [s, "s"],
  ] as Array<[number, string]>;

  return (
    <div className="inline-flex flex-col items-center gap-1">
      {label && (
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      )}
      <div className="flex items-baseline gap-1.5">
        {parts.map(([value, unit]) => (
          <span key={unit} className="flex items-baseline">
            <span className="font-display text-2xl font-extrabold tabular-nums sm:text-3xl">
              {String(value).padStart(2, "0")}
            </span>
            <span className="ml-0.5 font-mono text-xs text-muted-foreground">{unit}</span>
          </span>
        ))}
      </div>
      <div className="h-1 w-full rounded-full bg-wc-stripe" />
    </div>
  );
}
