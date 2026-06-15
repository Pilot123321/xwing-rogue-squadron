/**
 * F-16 six-degree-of-freedom equations of motion.
 *
 * Verbatim port of the Stevens & Lewis / AeroBenchVV `subf16_morelli.m` model.
 * State is the classic 13-element wind-axis + Euler vector; controls are
 * throttle plus the three aerodynamic surface commands. Returns the state
 * derivative plus the load factors (Nz, Ny) felt at the pilot station.
 *
 * Units: ft, ft/s, rad, rad/s, lb, slug. CG is fraction of mean chord.
 */

import { adc } from "./atmosphere.ts";
import { tgear, pdot, thrust } from "./engine.ts";
import { morelli, dampp } from "./aero.ts";
import {
  S, B, CBAR, RM, XCG, XCG_REF, HE, G0, RTOD,
  C1, C2, C3, C4, C5, C6, C7, C8, C9,
} from "./constants.ts";

/** State vector indices. */
export const X = {
  VT: 0, // true airspeed, ft/s
  ALPHA: 1, // angle of attack, rad
  BETA: 2, // sideslip, rad
  PHI: 3, // roll (bank) angle, rad
  THETA: 4, // pitch angle, rad
  PSI: 5, // yaw (heading), rad
  P: 6, // roll rate, rad/s
  Q: 7, // pitch rate, rad/s
  R: 8, // yaw rate, rad/s
  PN: 9, // north position, ft
  PE: 10, // east position, ft
  ALT: 11, // altitude, ft
  POW: 12, // engine power level state, %
} as const;

export const NSTATES = 13;

export interface Controls {
  throttle: number; // 0..1
  elevator: number; // deg (positive = trailing edge down -> nose down command-ish)
  aileron: number; // deg
  rudder: number; // deg
}

export interface Derivative {
  xd: Float64Array;
  /** Normal load factor at pilot station, g, zeroed at +1 g level flight. */
  Nz: number;
  /** Lateral load factor at pilot station, g. */
  Ny: number;
}

/** Distance the accelerometer (pilot station) sits ahead of the CG, ft. */
const XA = 15.0;

/**
 * Compute the state derivative.
 * @param x state vector (length 13)
 * @param u controls
 * @param thrustScale optional engine thrust multiplier (e.g. F110)
 * @param xcg optional CG override (fraction of cbar)
 */
export function f16Deriv(
  x: Float64Array,
  u: Controls,
  thrustScale = 1.0,
  xcg = XCG,
): Derivative {
  const xd = new Float64Array(NSTATES);

  const thtlc = u.throttle;
  const el = u.elevator;
  const ail = u.aileron;
  const rdr = u.rudder;

  const vt = x[X.VT];
  const alphaRad = x[X.ALPHA];
  const betaRad = x[X.BETA];
  const alphaDeg = alphaRad * RTOD;
  const phi = x[X.PHI];
  const theta = x[X.THETA];
  const psi = x[X.PSI];
  const p = x[X.P];
  const q = x[X.Q];
  const r = x[X.R];
  const alt = x[X.ALT];
  const pow = x[X.POW];

  // --- Propulsion ---
  const { mach, qbar } = adc(vt, alt);
  const cpow = tgear(thtlc);
  xd[X.POW] = pdot(pow, cpow);
  const t = thrust(pow, alt, mach, thrustScale);

  // --- Aerodynamics (static + control via Morelli) ---
  const aero = morelli(
    alphaRad, betaRad, el * (Math.PI / 180), ail * (Math.PI / 180), rdr * (Math.PI / 180),
    p, q, r, vt, xcg, XCG_REF,
  );
  let { Cx: cxt, Cy: cyt, Cz: czt, Cl: clt, Cm: cmt, Cn: cnt } = aero;

  // --- Rotary damping increments (dampp), applied as in the source ---
  const tvt = 0.5 / vt;
  const b2v = B * tvt;
  const cq = CBAR * q * tvt;
  const d = dampp(alphaDeg);
  cxt += cq * d[0];
  cyt += b2v * (d[1] * r + d[2] * p);
  czt += cq * d[3];
  clt += b2v * (d[4] * r + d[5] * p);
  cmt += cq * d[6] + czt * (XCG_REF - xcg);
  cnt += b2v * (d[7] * r + d[8] * p) - cyt * (XCG_REF - xcg) * (CBAR / B);

  // --- Body-axis velocity components from wind angles ---
  const cbta = Math.cos(betaRad);
  const uu = vt * Math.cos(alphaRad) * cbta;
  const vv = vt * Math.sin(betaRad);
  const ww = vt * Math.sin(alphaRad) * cbta;

  const sth = Math.sin(theta), cth = Math.cos(theta);
  const sph = Math.sin(phi), cph = Math.cos(phi);
  const spsi = Math.sin(psi), cpsi = Math.cos(psi);

  const qs = qbar * S;
  const qsb = qs * B;
  const rmqs = RM * qs;
  const gcth = G0 * cth;
  const qsph = q * sph;

  let ay = rmqs * cyt;
  let az = rmqs * czt;

  // --- Translational dynamics (body axes) ---
  const udot = r * vv - q * ww - G0 * sth + RM * (qs * cxt + t);
  const vdot = p * ww - r * uu + gcth * sph + ay;
  const wdot = q * uu - p * vv + gcth * cph + az;

  const dum = uu * uu + ww * ww;
  xd[X.VT] = (uu * udot + vv * vdot + ww * wdot) / vt;
  xd[X.ALPHA] = (uu * wdot - ww * udot) / dum;
  xd[X.BETA] = (vt * vdot - vv * xd[X.VT]) * cbta / dum;

  // --- Kinematics (Euler angle rates) ---
  xd[X.PHI] = p + (sth / cth) * (qsph + r * cph);
  xd[X.THETA] = q * cph - r * sph;
  xd[X.PSI] = (qsph + r * cph) / cth;

  // --- Rotational dynamics (inertia-coupled) ---
  xd[X.P] = (C2 * p + C1 * r + C4 * HE) * q + qsb * (C3 * clt + C4 * cnt);
  xd[X.Q] = (C5 * p - C7 * HE) * r + C6 * (r * r - p * p) + qs * CBAR * C7 * cmt;
  xd[X.R] = (C8 * p - C2 * r + C9 * HE) * q + qsb * (C4 * clt + C9 * cnt);

  // --- Navigation (position rates, NED) ---
  const t1 = sph * cpsi, t2 = cph * sth, t3 = sph * spsi;
  const s1 = cth * cpsi, s2 = cth * spsi, s3 = t1 * sth - cph * spsi;
  const s4 = t3 * sth + cph * cpsi, s5 = sph * cth, s6 = t2 * cpsi + t3;
  const s7 = t2 * spsi - t1, s8 = cph * cth;
  xd[X.PN] = uu * s1 + vv * s3 + ww * s6;
  xd[X.PE] = uu * s2 + vv * s4 + ww * s7;
  xd[X.ALT] = uu * sth - vv * s5 - ww * s8;

  // --- Accelerometer outputs translated to the pilot station ---
  az = az - XA * xd[X.Q];
  ay = ay + XA * xd[X.R];
  const Nz = -az / G0 - 1.0; // positive = pulling up, zeroed at 1 g level
  const Ny = ay / G0;

  return { xd, Nz, Ny };
}
