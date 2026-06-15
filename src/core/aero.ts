/**
 * F-16 aerodynamic coefficient model.
 *
 * `morelli()` is a verbatim port of Morelli's polynomial least-squares fit to
 * the NASA Langley wind-tunnel data (the "low-fidelity" model in Stevens &
 * Lewis / NASA TP-1538, as implemented in AeroBenchVV `Morellif16.m`). It is a
 * closed-form replacement for the original lookup tables and is valid roughly
 * over alpha in [-10, 45] deg and beta in [-30, 30] deg.
 *
 * `dampp()` returns the nine rotary (dynamic) damping derivatives as a function
 * of angle of attack, ported from `dampp.m`, and is applied on top of the
 * Morelli static coefficients in the equations of motion.
 *
 * Angles into `morelli` are RADIANS; `dampp` takes alpha in DEGREES (matching
 * the source routines). The EOM module wires them together correctly.
 */

import { CBAR, B } from "./constants.ts";

export interface AeroCoeffs {
  Cx: number; // axial force (body x)
  Cy: number; // side force (body y)
  Cz: number; // normal force (body z)
  Cl: number; // rolling moment
  Cm: number; // pitching moment
  Cn: number; // yawing moment
}

// Morelli polynomial coefficients (Morellif16.m).
const a0 = -1.943367e-2, a1 = 2.136104e-1, a2 = -2.903457e-1, a3 = -3.348641e-3,
  a4 = -2.060504e-1, a5 = 6.988016e-1, a6 = -9.035381e-1;
const b0 = 4.833383e-1, b1 = 8.644627, b2 = 1.131098e1, b3 = -7.422961e1, b4 = 6.075776e1;
const c0 = -1.145916, c1 = 6.016057e-2, c2 = 1.642479e-1;
const d0 = -1.006733e-1, d1 = 8.679799e-1, d2 = 4.260586, d3 = -6.923267;
const e0 = 8.071648e-1, e1 = 1.189633e-1, e2 = 4.177702, e3 = -9.162236;
const f0 = -1.378278e-1, f1 = -4.211369, f2 = 4.775187, f3 = -1.026225e1, f4 = 8.399763, f5 = -4.354000e-1;
const g0 = -3.054956e1, g1 = -4.132305e1, g2 = 3.292788e2, g3 = -6.848038e2, g4 = 4.080244e2;
const h0 = -1.05853e-1, h1 = -5.776677e-1, h2 = -1.672435e-2, h3 = 1.357256e-1,
  h4 = 2.172952e-1, h5 = 3.464156, h6 = -2.835451, h7 = -1.098104;
const i0 = -4.126806e-1, i1 = -1.189974e-1, i2 = 1.247721, i3 = -7.391132e-1;
const j0 = 6.250437e-2, j1 = 6.067723e-1, j2 = -1.101964, j3 = 9.100087, j4 = -1.192672e1;
const k0 = -1.463144e-1, k1 = -4.07391e-2, k2 = 3.253159e-2, k3 = 4.851209e-1,
  k4 = 2.978850e-1, k5 = -3.746393e-1, k6 = -3.213068e-1;
const l0 = 2.635729e-2, l1 = -2.192910e-2, l2 = -3.152901e-3, l3 = -5.817803e-2,
  l4 = 4.516159e-1, l5 = -4.928702e-1, l6 = -1.579864e-2;
const m0 = -2.029370e-2, m1 = 4.660702e-2, m2 = -6.012308e-1, m3 = -8.062977e-2,
  m4 = 8.320429e-2, m5 = 5.018538e-1, m6 = 6.378864e-1, m7 = 4.226356e-1;
const n0 = -5.19153, n1 = -3.554716, n2 = -3.598636e1, n3 = 2.247355e2, n4 = -4.120991e2, n5 = 2.411750e2;
const o0 = 2.993363e-1, o1 = 6.594004e-2, o2 = -2.003125e-1, o3 = -6.233977e-2,
  o4 = -2.107885, o5 = 2.141420, o6 = 8.476901e-1;
const p0 = 2.677652e-2, p1 = -3.298246e-1, p2 = 1.926178e-1, p3 = 4.013325, p4 = -4.404302;
const q0 = -3.698756e-1, q1 = -1.167551e-1, q2 = -7.641297e-1;
const r0 = -3.348717e-2, r1 = 4.276655e-2, r2 = 6.573646e-3, r3 = 3.535831e-1, r4 = -1.373308,
  r5 = 1.237582, r6 = 2.302543e-1, r7 = -2.512876e-1, r8 = 1.588105e-1, r9 = -5.199526e-1;
const s0 = -8.115894e-2, s1 = -1.156580e-2, s2 = 2.514167e-2, s3 = 2.038748e-1, s4 = -3.337476e-1, s5 = 1.004297e-1;

/**
 * Static + control aerodynamic coefficients in body axes.
 * @param alpha angle of attack, rad
 * @param beta sideslip, rad
 * @param de elevator (symmetric stabilator), rad
 * @param da aileron (differential flaperon), rad
 * @param dr rudder, rad
 * @param p,q,r body rates, rad/s
 * @param V true airspeed, ft/s
 * @param xcg current CG (fraction of cbar)
 * @param xcgref reference CG (fraction of cbar)
 */
export function morelli(
  alpha: number, beta: number, de: number, da: number, dr: number,
  p: number, q: number, r: number, V: number, xcg: number, xcgref: number,
): AeroCoeffs {
  const phat = (p * B) / (2 * V);
  const qhat = (q * CBAR) / (2 * V);
  const rhat = (r * B) / (2 * V);

  const Cx0 = a0 + a1 * alpha + a2 * de * de + a3 * de + a4 * alpha * de + a5 * alpha ** 2 + a6 * alpha ** 3;
  const Cxq = b0 + b1 * alpha + b2 * alpha ** 2 + b3 * alpha ** 3 + b4 * alpha ** 4;
  const Cy0 = c0 * beta + c1 * da + c2 * dr;
  const Cyp = d0 + d1 * alpha + d2 * alpha ** 2 + d3 * alpha ** 3;
  const Cyr = e0 + e1 * alpha + e2 * alpha ** 2 + e3 * alpha ** 3;
  const Cz0 = (f0 + f1 * alpha + f2 * alpha ** 2 + f3 * alpha ** 3 + f4 * alpha ** 4) * (1 - beta ** 2) + f5 * de;
  const Czq = g0 + g1 * alpha + g2 * alpha ** 2 + g3 * alpha ** 3 + g4 * alpha ** 4;
  const Cl0 = h0 * beta + h1 * alpha * beta + h2 * alpha ** 2 * beta + h3 * beta ** 2 +
    h4 * alpha * beta ** 2 + h5 * alpha ** 3 * beta + h6 * alpha ** 4 * beta + h7 * alpha ** 2 * beta ** 2;
  const Clp = i0 + i1 * alpha + i2 * alpha ** 2 + i3 * alpha ** 3;
  const Clr = j0 + j1 * alpha + j2 * alpha ** 2 + j3 * alpha ** 3 + j4 * alpha ** 4;
  const Clda = k0 + k1 * alpha + k2 * beta + k3 * alpha ** 2 + k4 * alpha * beta + k5 * alpha ** 2 * beta + k6 * alpha ** 3;
  const Cldr = l0 + l1 * alpha + l2 * beta + l3 * alpha * beta + l4 * alpha ** 2 * beta + l5 * alpha ** 3 * beta + l6 * beta ** 2;
  const Cm0 = m0 + m1 * alpha + m2 * de + m3 * alpha * de + m4 * de * de + m5 * alpha ** 2 * de + m6 * de ** 3 + m7 * alpha * de * de;
  const Cmq = n0 + n1 * alpha + n2 * alpha ** 2 + n3 * alpha ** 3 + n4 * alpha ** 4 + n5 * alpha ** 5;
  const Cn0 = o0 * beta + o1 * alpha * beta + o2 * beta ** 2 + o3 * alpha * beta ** 2 + o4 * alpha ** 2 * beta + o5 * alpha ** 2 * beta ** 2 + o6 * alpha ** 3 * beta;
  const Cnp = p0 + p1 * alpha + p2 * alpha ** 2 + p3 * alpha ** 3 + p4 * alpha ** 4;
  const Cnr = q0 + q1 * alpha + q2 * alpha ** 2;
  const Cnda = r0 + r1 * alpha + r2 * beta + r3 * alpha * beta + r4 * alpha ** 2 * beta + r5 * alpha ** 3 * beta + r6 * alpha ** 2 + r7 * alpha ** 3 + r8 * beta ** 3 + r9 * alpha * beta ** 3;
  const Cndr = s0 + s1 * alpha + s2 * beta + s3 * alpha * beta + s4 * alpha ** 2 * beta + s5 * alpha ** 2;

  const Cx = Cx0 + Cxq * qhat;
  const Cy = Cy0 + Cyp * phat + Cyr * rhat;
  const Cz = Cz0 + Czq * qhat;
  const Cl = Cl0 + Clp * phat + Clr * rhat + Clda * da + Cldr * dr;
  const Cm = Cm0 + Cmq * qhat + Cz * (xcgref - xcg);
  const Cn = Cn0 + Cnp * phat + Cnr * rhat + Cnda * da + Cndr * dr - Cy * (xcgref - xcg) * (CBAR / B);

  return { Cx, Cy, Cz, Cl, Cm, Cn };
}

// Rotary damping derivative table (dampp.m), rows = derivative, cols = alpha
// breakpoints at -10:5:45 deg. Order: CXq, CYr, CYp, CZq, Clr, Clp, Cmq, Cnr, Cnp.
const DAMP = [
  [-0.267, -0.110, 0.308, 1.34, 2.08, 2.91, 2.76, 2.05, 1.50, 1.49, 1.83, 1.21],
  [0.882, 0.852, 0.876, 0.958, 0.962, 0.974, 0.819, 0.483, 0.590, 1.21, -0.493, -1.04],
  [-0.108, -0.108, -0.188, 0.110, 0.258, 0.226, 0.344, 0.362, 0.611, 0.529, 0.298, -2.27],
  [-8.80, -25.8, -28.9, -31.4, -31.2, -30.7, -27.7, -28.2, -29.0, -29.8, -38.3, -35.3],
  [-0.126, -0.026, 0.063, 0.113, 0.208, 0.230, 0.319, 0.437, 0.680, 0.100, 0.447, -0.330],
  [-0.360, -0.359, -0.443, -0.420, -0.383, -0.375, -0.329, -0.294, -0.230, -0.210, -0.120, -0.100],
  [-7.21, -0.540, -5.23, -5.26, -6.11, -6.64, -5.69, -6.00, -6.20, -6.40, -6.60, -6.00],
  [-0.380, -0.363, -0.378, -0.386, -0.370, -0.453, -0.550, -0.582, -0.595, -0.637, -1.02, -0.840],
  [0.061, 0.052, 0.052, -0.012, -0.013, -0.024, 0.050, 0.150, 0.130, 0.158, 0.240, 0.150],
];

/**
 * Nine damping derivatives interpolated at angle of attack.
 * @param alphaDeg angle of attack, DEGREES
 * @returns [CXq, CYr, CYp, CZq, Clr, Clp, Cmq, Cnr, Cnp]
 */
export function dampp(alphaDeg: number): number[] {
  const s = 0.2 * alphaDeg;
  let k = Math.trunc(s);
  if (k <= -2) k = -1;
  if (k >= 9) k = 8;
  const da = s - k;
  const sign = da > 0 ? 1 : da < 0 ? -1 : 0;
  let l = k + Math.trunc(1.1 * sign);
  // Shift from the source's 1-based [-2..9] indexing to 0-based array indices.
  k += 3 - 1;
  l += 3 - 1;
  const out: number[] = new Array(9);
  for (let i = 0; i < 9; i++) {
    out[i] = DAMP[i][k] + Math.abs(da) * (DAMP[i][l] - DAMP[i][k]);
  }
  return out;
}
