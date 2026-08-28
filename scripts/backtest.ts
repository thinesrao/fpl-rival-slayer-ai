// Usage: npm run backtest
//
// Downloads (and caches) the 2025-26 gameweek corpus, scores the held-out
// benchmark rounds, and writes .backtest/report.json plus a human summary.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

import { RULE_CURRENT_SEASON, buildManifest, loadGameweek, sha256, type ManifestEntry } from "../src/lib/backtest/corpus";
import { HOLDOUT_ROUNDS, runBacktest } from "../src/lib/backtest/runner";
import { intervalCoverage, type MetricResult } from "../src/lib/backtest/evaluate";
import { estimateVariance, fitVariance } from "../src/lib/projections/variance";

const BAR = { rmse: 2.691, spearman: 0.507 };

function line(label: string, m: MetricResult): string {
  if (!m.ok) return `${label.padEnd(22)} n=${String(m.n).padStart(6)}  (${m.reason})`;
  return (
    `${label.padEnd(22)} n=${String(m.n).padStart(6)}  ` +
    `RMSE=${m.rmse.toFixed(3)}  MAE=${m.mae.toFixed(3)}  rho=${m.spearman.toFixed(3)}`
  );
}

async function main(): Promise<void> {
  const report = await runBacktest({
    rounds: [...HOLDOUT_ROUNDS],
    loader: (round) => loadGameweek(RULE_CURRENT_SEASON, round),
  });

  const out: string[] = [];
  out.push(`season ${report.season}  rounds ${report.roundsEvaluated.join(",")}`);
  if (report.gaps.length) out.push(`gaps (not published): ${report.gaps.join(",")}`);
  out.push("");
  out.push("STARTERS (the decision-relevant segment)");
  out.push("  " + line("our model", report.starters.model));
  out.push("  " + line("FPL xP (the bar)", report.starters.fplXp));
  out.push("");
  out.push("ALL ROWS");
  out.push("  " + line("our model", report.all.model));
  out.push("  " + line("FPL xP", report.all.fplXp));
  out.push("");
  out.push("BY POSITION (starters, our model)");
  for (const [pos, m] of Object.entries(report.byPosition)) out.push("  " + line(pos, m));
  out.push("");

  const fittedVariance = fitVariance(
    report.predictions.map((p) => ({ position: p.position, ourXp: p.ourXp, actual: p.actual })),
  );
  const starters = report.predictions.filter((p) => p.started);
  const coverage80 = intervalCoverage(
    starters.map((p) => p.ourXp),
    starters.map((p) => Math.sqrt(estimateVariance(p.position, p.ourXp, fittedVariance))),
    starters.map((p) => p.actual),
  );
  const enriched = { ...report, fittedVariance, coverage80 };

  const m = report.starters.model;
  const passes = m.ok && m.rmse < BAR.rmse && m.spearman > BAR.spearman;
  out.push(
    `80% interval coverage (starters): ${(coverage80 * 100).toFixed(1)}%  ` +
      `(target 78-82%)`,
  );
  out.push(
    `SHIP GATE: ${passes ? "PASS" : "FAIL"}  ` +
      `(need RMSE < ${BAR.rmse} and rho > ${BAR.spearman} on starters)`,
  );

  const cacheDir = `.backtest/${RULE_CURRENT_SEASON}`;
  const entries: ManifestEntry[] = readdirSync(cacheDir)
    .filter((f) => f.endsWith(".csv"))
    .map((file) => {
      const text = readFileSync(`${cacheDir}/${file}`, "utf8");
      const rows = text.trim().split("\n");
      return {
        season: RULE_CURRENT_SEASON,
        round: Number(file.replace(/^gw|\.csv$/g, "")),
        rows: rows.length - 1,
        sha256: sha256(text),
        hasXp: rows.slice(1).some((line) => {
          const cols = rows[0].split(",");
          const idx = cols.indexOf("xP");
          return idx >= 0 && Number(line.split(",")[idx]) !== 0;
        }),
      };
    });
  writeFileSync("docs/backtest-manifest.json", buildManifest(entries));

  mkdirSync(".backtest", { recursive: true });
  writeFileSync(".backtest/report.json", JSON.stringify(enriched, null, 2));
  writeFileSync(".backtest/report.txt", out.join("\n") + "\n");
  process.stdout.write(out.join("\n") + "\n");
  process.stdout.write("\nwrote .backtest/report.json and .backtest/report.txt\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`backtest failed: ${String(error)}\n`);
  process.exitCode = 1;
});
