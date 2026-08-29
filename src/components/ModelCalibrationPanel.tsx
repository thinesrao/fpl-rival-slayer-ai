"use client";

import { useModelReport } from "@/components/ModelTrustBadge";

export function ModelCalibrationPanel() {
  const { data, isLoading, isError } = useModelReport();

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading model report…</div>;
  if (isError || !data) return null;

  const { starters, shipGate } = data;

  return (
    <section className="space-y-3 rounded-lg border bg-card/40 p-4">
      <header className="space-y-1">
        <h3 className="font-display text-sm font-bold uppercase tracking-tight">How accurate are these numbers?</h3>
        <p className="text-xs text-muted-foreground">
          Measured on {starters.model.n.toLocaleString()} players who started across{" "}
          {data.rounds.length} held-out gameweeks in {data.season}.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase text-muted-foreground">Our model</dt>
          <dd className="font-mono">
            RMSE {starters.model.rmse.toFixed(2)} · ρ {starters.model.spearman.toFixed(3)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-muted-foreground">FPL&apos;s own xP</dt>
          <dd className="font-mono">
            RMSE {starters.fplXp.rmse.toFixed(2)} · ρ {starters.fplXp.spearman.toFixed(3)}
          </dd>
        </div>
      </dl>

      {!shipGate.passes && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          Our model does not yet beat FPL&apos;s own expected points on this holdout, so treat
          the projections as directional rather than decisive.
        </p>
      )}

      {data.calibration.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs uppercase text-muted-foreground">Predicted vs actual</h4>
          <ul className="space-y-0.5 font-mono text-xs">
            {data.calibration
              .filter((b) => b.n > 0)
              .map((b, i) => (
                <li key={i} className="flex justify-between">
                  <span>we said {b.meanPredicted.toFixed(1)}</span>
                  <span className="text-muted-foreground">
                    they scored {b.meanActual.toFixed(1)} (n={b.n})
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
