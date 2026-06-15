/**
 * Trim solver for the F-16 model.
 *
 * Finds the control settings and angle of attack that null the relevant state
 * derivatives for a requested steady condition. Uses a derivative-free
 * Nelder-Mead simplex on a quadratic cost of the residual accelerations,
 * mirroring the approach of the reference `clf16.m`/`trimmerFun.m`.
 */

import { f16Deriv, X, NSTATES, type Controls } from "./dynamics.ts";
import { tgear } from "./engine.ts";

export interface TrimCondition {
  vt: number; // ft/s
  alt: number; // ft
  gamma?: number; // flight-path angle, rad (climb); default 0 (level)
  /** Steady turn rate, rad/s, about the vertical (coordinated). Default 0. */
  turnRate?: number;
  thrustScale?: number;
  xcg?: number;
}

export interface TrimResult {
  x: Float64Array;
  u: Controls;
  alpha: number; // rad
  theta: number; // rad
  phi: number; // rad (bank, for turns)
  cost: number;
  Nz: number;
  iterations: number;
}

/** Build the full state from the free trim variables and the condition. */
function buildState(
  vars: number[],
  cond: TrimCondition,
): { x: Float64Array; u: Controls; phi: number } {
  const [alpha, throttle, elevator, aileron, rudder] = vars;
  const gamma = cond.gamma ?? 0;
  const turnRate = cond.turnRate ?? 0;

  const x = new Float64Array(NSTATES);
  x[X.VT] = cond.vt;
  x[X.ALPHA] = alpha;
  x[X.BETA] = 0;
  x[X.ALT] = cond.alt;
  x[X.POW] = tgear(Math.min(1, Math.max(0, throttle)));

  const theta = alpha + gamma;
  x[X.THETA] = theta;

  let phi = 0;
  if (turnRate !== 0) {
    // Coordinated-turn bank from rate and speed: tan(phi) = V*omega/g.
    phi = Math.atan2(cond.vt * turnRate, 32.17);
    x[X.PHI] = phi;
    // Body rates for a steady coordinated turn.
    x[X.P] = -turnRate * Math.sin(theta);
    x[X.Q] = turnRate * Math.cos(theta) * Math.sin(phi);
    x[X.R] = turnRate * Math.cos(theta) * Math.cos(phi);
  }

  const u: Controls = {
    throttle: Math.min(1, Math.max(0, throttle)),
    elevator,
    aileron,
    rudder,
  };
  return { x, u, phi };
}

function cost(vars: number[], cond: TrimCondition): number {
  const { x, u } = buildState(vars, cond);
  const { xd } = f16Deriv(x, u, cond.thrustScale ?? 1.0, cond.xcg);
  // Penalize residual rates of the dynamic states.
  const w = {
    vt: 2.0,
    alpha: 10.0,
    beta: 10.0,
    p: 10.0,
    q: 10.0,
    r: 10.0,
  };
  return (
    w.vt * xd[X.VT] ** 2 +
    w.alpha * xd[X.ALPHA] ** 2 +
    w.beta * xd[X.BETA] ** 2 +
    w.p * xd[X.P] ** 2 +
    w.q * xd[X.Q] ** 2 +
    w.r * xd[X.R] ** 2
  );
}

/** Generic Nelder-Mead simplex minimizer. */
function nelderMead(
  f: (v: number[]) => number,
  x0: number[],
  opts: { maxIter?: number; tol?: number; step?: number } = {},
): { x: number[]; fx: number; iters: number } {
  const maxIter = opts.maxIter ?? 4000;
  const tol = opts.tol ?? 1e-12;
  const step = opts.step ?? 0.1;
  const n = x0.length;

  // Initial simplex.
  const simplex: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const pt = x0.slice();
    pt[i] += (pt[i] !== 0 ? pt[i] * 0.05 : 0) + step;
    simplex.push(pt);
  }
  let fvals = simplex.map(f);

  const order = () => {
    const idx = fvals.map((_, i) => i).sort((a, b) => fvals[a] - fvals[b]);
    simplex.splice(0, simplex.length, ...idx.map((i) => simplex[i]));
    fvals = idx.map((i) => fvals[i]);
  };

  let iters = 0;
  for (; iters < maxIter; iters++) {
    order();
    if (Math.abs(fvals[n] - fvals[0]) <= tol * (Math.abs(fvals[0]) + tol)) break;

    // Centroid of all but the worst point.
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;

    const worst = simplex[n];
    const reflect = c.map((cj, j) => cj + 1.0 * (cj - worst[j]));
    const fr = f(reflect);

    if (fr < fvals[0]) {
      const expand = c.map((cj, j) => cj + 2.0 * (cj - worst[j]));
      const fe = f(expand);
      if (fe < fr) { simplex[n] = expand; fvals[n] = fe; }
      else { simplex[n] = reflect; fvals[n] = fr; }
    } else if (fr < fvals[n - 1]) {
      simplex[n] = reflect; fvals[n] = fr;
    } else {
      const contract = c.map((cj, j) => cj + 0.5 * (worst[j] - cj));
      const fc = f(contract);
      if (fc < fvals[n]) { simplex[n] = contract; fvals[n] = fc; }
      else {
        // Shrink toward the best vertex.
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          fvals[i] = f(simplex[i]);
        }
      }
    }
  }
  order();
  return { x: simplex[0], fx: fvals[0], iters };
}

/**
 * Solve for trim. Free variables: [alpha, throttle, elevator, aileron, rudder].
 */
export function trim(cond: TrimCondition): TrimResult {
  // Reasonable starting guess: small positive alpha, mid throttle, near-zero surfaces.
  const guess = [0.05, 0.3, -2.0, 0, 0];
  const res = nelderMead((v) => cost(v, cond), guess, { step: 0.05, maxIter: 6000 });
  // Polish from the solution to tighten residuals.
  const res2 = nelderMead((v) => cost(v, cond), res.x, { step: 0.005, maxIter: 4000 });

  const { x, u, phi } = buildState(res2.x, cond);
  const { Nz } = f16Deriv(x, u, cond.thrustScale ?? 1.0, cond.xcg);
  return {
    x,
    u,
    alpha: res2.x[0],
    theta: x[X.THETA],
    phi,
    cost: res2.fx,
    Nz,
    iterations: res.iters + res2.iters,
  };
}
