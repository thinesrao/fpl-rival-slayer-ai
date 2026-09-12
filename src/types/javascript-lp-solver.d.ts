// Minimal ambient types for javascript-lp-solver, which ships untyped JS and
// has no @types package. Only the model shape and `Solve` entry point that
// @/lib/optimizer/wildcard actually uses are declared — deliberately narrow,
// so a wrong model shape is a compile error rather than an `any`.

declare module "javascript-lp-solver" {
  /** A constraint bound. At least one of the three is set. */
  export interface LpConstraint {
    min?: number;
    max?: number;
    equal?: number;
  }

  /**
   * One decision variable: the objective coefficient under the key named by
   * `optimize`, plus its coefficient in each constraint it appears in.
   */
  export type LpVariable = Record<string, number>;

  export interface LpModel {
    /** Name of the coefficient key to optimise, e.g. "score". */
    optimize: string;
    opType: "max" | "min";
    constraints: Record<string, LpConstraint>;
    variables: Record<string, LpVariable>;
    /** Variable names restricted to {0,1}. */
    binaries?: Record<string, number>;
    /** Variable names restricted to integers. */
    ints?: Record<string, number>;
  }

  /**
   * Solved values keyed by variable name, plus `feasible`, the objective
   * value in `result`, and `bounded`. Variables the solver left at zero are
   * absent rather than 0, so read them defensively.
   */
  export type LpSolution = Record<string, number | boolean | undefined> & {
    feasible: boolean;
    result: number;
    bounded?: boolean;
  };

  export function Solve(model: LpModel): LpSolution;

  const solver: { Solve: typeof Solve };
  export default solver;
}
