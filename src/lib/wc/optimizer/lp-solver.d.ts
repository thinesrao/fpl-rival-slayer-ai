// javascript-lp-solver ships no TypeScript types; minimal shim for our usage.
declare module "javascript-lp-solver" {
  export interface LpModel {
    optimize: string;
    opType: "max" | "min";
    constraints: Record<string, { max?: number; min?: number; equal?: number }>;
    variables: Record<string, Record<string, number>>;
    ints?: Record<string, number>;
    binaries?: Record<string, number>;
  }
  export interface LpResult {
    feasible: boolean;
    result: number;
    bounded?: boolean;
    [variable: string]: number | boolean | undefined;
  }
  export function Solve(model: LpModel): LpResult;
  const solver: { Solve: typeof Solve };
  export default solver;
}
