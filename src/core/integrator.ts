/**
 * Fixed-step RK4 integrator for the 13-state F-16 model.
 */

import { f16Deriv, type Controls, type Derivative, NSTATES } from "./dynamics.ts";

export interface StepResult {
  x: Float64Array;
  Nz: number;
  Ny: number;
}

function addScaled(base: Float64Array, k: Float64Array, h: number): Float64Array {
  const out = new Float64Array(NSTATES);
  for (let i = 0; i < NSTATES; i++) out[i] = base[i] + k[i] * h;
  return out;
}

/**
 * Advance the state by one RK4 step of size `dt` (seconds).
 * Controls are held constant across the step (zero-order hold), which is the
 * usual convention when an outer control loop runs at the same rate.
 */
export function rk4Step(
  x: Float64Array,
  u: Controls,
  dt: number,
  thrustScale = 1.0,
  xcg?: number,
): StepResult {
  const d1: Derivative = f16Deriv(x, u, thrustScale, xcg);
  const d2 = f16Deriv(addScaled(x, d1.xd, dt / 2), u, thrustScale, xcg);
  const d3 = f16Deriv(addScaled(x, d2.xd, dt / 2), u, thrustScale, xcg);
  const d4 = f16Deriv(addScaled(x, d3.xd, dt), u, thrustScale, xcg);

  const out = new Float64Array(NSTATES);
  for (let i = 0; i < NSTATES; i++) {
    out[i] = x[i] + (dt / 6) * (d1.xd[i] + 2 * d2.xd[i] + 2 * d3.xd[i] + d4.xd[i]);
  }
  // Report load factors sampled at the start of the step (pilot-relevant).
  return { x: out, Nz: d1.Nz, Ny: d1.Ny };
}
