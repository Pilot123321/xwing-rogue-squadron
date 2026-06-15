/**
 * Top-level F-16C aircraft: closes the FLCS around the 6-DOF airframe.
 *
 * Each `step` reads sensor feedback (load factors computed from the previous
 * frame's surface commands — the one-frame delay of a digital flight control
 * computer), runs the FLCS to get new surface commands, then integrates the
 * airframe one RK4 step.
 */

import { rk4Step } from "./integrator.ts";
import { f16Deriv, X, NSTATES, type Controls } from "./dynamics.ts";
import { FLCS, type StickInput, type FlcsState, type SurfaceCommands } from "./flcs.ts";
import { adc, tasToKcas } from "./atmosphere.ts";
import { tgear, F110_THRUST_SCALE } from "./engine.ts";
import { RTOD } from "./constants.ts";

export interface AircraftInit {
  vt: number; // ft/s
  alt: number; // ft
  alpha?: number; // rad
  theta?: number; // rad
  psi?: number; // rad
  throttle?: number; // 0..1, sets initial power state
  thrustScale?: number;
  xcg?: number;
}

/** Convenient read-only snapshot of aircraft state for HUD / rendering. */
export interface Telemetry {
  vt: number; // ft/s
  kcas: number;
  mach: number;
  alphaDeg: number;
  betaDeg: number;
  altFt: number;
  phiDeg: number;
  thetaDeg: number;
  psiDeg: number;
  pDegS: number;
  qDegS: number;
  rDegS: number;
  Nz: number; // total load factor (g), 1.0 = level
  g: number; // alias of Nz total
  vviFtMin: number; // vertical velocity, ft/min
  surfaces: SurfaceCommands;
  pn: number;
  pe: number;
}

export class Aircraft {
  x: Float64Array;
  flcs = new FLCS();
  flcsState: FlcsState = { mpo: false };
  private lastU: Controls;
  private thrustScale: number;
  private xcg?: number;
  private lastSurfaces: SurfaceCommands;

  constructor(init: AircraftInit) {
    this.thrustScale = init.thrustScale ?? F110_THRUST_SCALE;
    this.xcg = init.xcg;
    const x = new Float64Array(NSTATES);
    x[X.VT] = init.vt;
    x[X.ALPHA] = init.alpha ?? 0;
    x[X.BETA] = 0;
    x[X.THETA] = init.theta ?? init.alpha ?? 0;
    x[X.PSI] = init.psi ?? 0;
    x[X.ALT] = init.alt;
    x[X.POW] = tgear(init.throttle ?? 0.7);
    this.x = x;
    this.lastU = { throttle: init.throttle ?? 0.7, elevator: 0, aileron: 0, rudder: 0 };
    this.lastSurfaces = { ...this.lastU, lef: 0 };
  }

  /** Set the full state directly (e.g. from a trim solution). */
  setState(x: Float64Array): void {
    this.x = x.slice();
  }

  /** Advance one step of size dt (s) under the given stick input. */
  step(stick: StickInput, dt: number): Telemetry {
    // Sensors: load factors from the previous frame's surfaces (FLCC delay).
    const prev = f16Deriv(this.x, this.lastU, this.thrustScale, this.xcg);
    const sensors = {
      Nz: prev.Nz,
      alphaDeg: this.x[X.ALPHA] * RTOD,
      betaDeg: this.x[X.BETA] * RTOD,
      p: this.x[X.P],
      q: this.x[X.Q],
      r: this.x[X.R],
      vt: this.x[X.VT],
    };

    const cmd = this.flcs.update(sensors, stick, dt, this.flcsState);
    const u: Controls = {
      throttle: cmd.throttle,
      elevator: cmd.elevator,
      aileron: cmd.aileron,
      rudder: cmd.rudder,
    };

    const res = rk4Step(this.x, u, dt, this.thrustScale, this.xcg);
    this.x = res.x;
    this.lastU = u;
    this.lastSurfaces = cmd;

    return this.telemetry(res.Nz);
  }

  telemetry(nz?: number): Telemetry {
    const { mach } = adc(this.x[X.VT], this.x[X.ALT]);
    const Nz = nz ?? f16Deriv(this.x, this.lastU, this.thrustScale, this.xcg).Nz;
    const vvi = -0; // computed below from altitude rate
    const d = f16Deriv(this.x, this.lastU, this.thrustScale, this.xcg);
    return {
      vt: this.x[X.VT],
      kcas: tasToKcas(this.x[X.VT], this.x[X.ALT]),
      mach,
      alphaDeg: this.x[X.ALPHA] * RTOD,
      betaDeg: this.x[X.BETA] * RTOD,
      altFt: this.x[X.ALT],
      phiDeg: this.x[X.PHI] * RTOD,
      thetaDeg: this.x[X.THETA] * RTOD,
      psiDeg: this.x[X.PSI] * RTOD,
      pDegS: this.x[X.P] * RTOD,
      qDegS: this.x[X.Q] * RTOD,
      rDegS: this.x[X.R] * RTOD,
      Nz: Nz + 1,
      g: Nz + 1,
      vviFtMin: d.xd[X.ALT] * 60,
      surfaces: this.lastSurfaces,
      pn: this.x[X.PN],
      pe: this.x[X.PE],
    };
  }
}
