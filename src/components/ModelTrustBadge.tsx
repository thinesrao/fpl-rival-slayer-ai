"use client";

// Single source of truth for "does our model beat FPL's own xP?" — the ship
// gate defined in @/lib/projections/model-report. Both the headline stat
// tiles (this file's ModelTrustBadge) and the full calibration breakdown
// (ModelCalibrationPanel) read the gate through useModelReport below, so
// there is exactly one fetch and one place that decides what "passes" means.

import { useQuery } from "@tanstack/react-query";

import type { ModelReport } from "@/lib/projections/model-report";
import { cn } from "@/lib/utils";

/** Exported so it can be unit-tested directly, without a rendering environment. */
export async function fetchModelReport(): Promise<ModelReport> {
  const res = await fetch("/api/model-report");
  if (!res.ok) throw new Error(`model report unavailable (${res.status})`);
  return (await res.json()) as ModelReport;
}

/**
 * Pure decision of whether the trust badge should be visible, split out of
 * the component so the two gate states are unit-testable without a
 * rendering environment: visible when the report loaded and the ship gate
 * has NOT passed, hidden while loading/erroring or once the gate passes.
 */
export function shouldShowModelTrustBadge(report: ModelReport | undefined): boolean {
  return report !== undefined && !report.shipGate.passes;
}

/**
 * Shared TanStack Query hook for the model accuracy report. Uses the same
 * query key as every other consumer so React Query dedupes onto one
 * in-flight request / cache entry regardless of how many components mount.
 */
export function useModelReport() {
  return useQuery({
    queryKey: ["model-report"],
    queryFn: fetchModelReport,
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Compact inline disclosure for headline model-derived numbers (projected
 * XI, overtake odds, etc.). Shown only when the ship gate has not passed —
 * i.e. our model does not yet beat FPL's own published expected points on
 * the held-out benchmark. Renders nothing while loading, on error, or once
 * the gate passes, so it never flashes a false or stale claim.
 *
 * This does not change any displayed number — it only adds disclosure next
 * to it. The full RMSE/Spearman comparison lives in ModelCalibrationPanel.
 */
export function ModelTrustBadge({ className }: { className?: string }) {
  const { data } = useModelReport();
  if (!shouldShowModelTrustBadge(data)) return null;

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:text-amber-300",
        className,
      )}
      title="Our xP model does not yet beat FPL's own expected points on the held-out benchmark — see Past gameweeks for the full comparison."
    >
      Directional — does not yet beat FPL&apos;s own xP
    </span>
  );
}
