// The ship gate. We publish our own expected points only when they beat FPL's,
// which every manager already gets for nothing. A tie is not an improvement.
//
// The bar is FPL's xP measured on 2025-26 starters — the most recent season
// under the current scoring rules.

export const SHIP_GATE_BAR = { rmse: 2.691, spearman: 0.507 } as const;

export interface ShipGate {
  passes: boolean;
  rmseBar: number;
  spearmanBar: number;
}

export function evaluateShipGate(starters: { rmse: number; spearman: number }): ShipGate {
  return {
    passes: starters.rmse < SHIP_GATE_BAR.rmse && starters.spearman > SHIP_GATE_BAR.spearman,
    rmseBar: SHIP_GATE_BAR.rmse,
    spearmanBar: SHIP_GATE_BAR.spearman,
  };
}

export interface MetricSummary {
  rmse: number;
  mae: number;
  spearman: number;
  n: number;
}

export interface ModelReport {
  generatedAt: string;
  season: string;
  rounds: number[];
  starters: { model: MetricSummary; fplXp: MetricSummary };
  shipGate: ShipGate;
  calibration: Array<{ meanPredicted: number; meanActual: number; n: number }>;
}
