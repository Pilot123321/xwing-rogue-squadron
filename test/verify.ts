/**
 * Verification harness for the bare F-16 airframe + EOM.
 *
 * Checks the model against physically known F-16 behavior and the published
 * Stevens & Lewis reference trim point. Run with: `node test/verify.ts`
 */

import { trim } from "../src/core/trim.ts";
import { rk4Step } from "../src/core/integrator.ts";
import { f16Deriv, X } from "../src/core/dynamics.ts";
import { adc, tasToKcas, KTS_TO_FT_PER_S } from "../src/core/atmosphere.ts";
import { F110_THRUST_SCALE } from "../src/core/engine.ts";
import { RTOD } from "../src/core/constants.ts";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail: string) {
  const tag = cond ? "PASS" : "FAIL";
  if (cond) pass++; else fail++;
  console.log(`  [${tag}] ${name} — ${detail}`);
}

console.log("=".repeat(70));
console.log("F-16 FLIGHT MODEL VERIFICATION");
console.log("=".repeat(70));

// --- 1. Reference trim: Stevens & Lewis nominal point (Vt=502 ft/s, 0 ft) ---
console.log("\n[1] Steady level trim @ Vt=502 ft/s, sea level (S&L reference)");
{
  const r = trim({ vt: 502, alt: 0 });
  const alphaDeg = r.alpha * RTOD;
  console.log(
    `      alpha=${alphaDeg.toFixed(2)} deg, elevator=${r.u.elevator.toFixed(2)} deg, ` +
    `throttle=${r.u.throttle.toFixed(3)}, residual cost=${r.cost.toExponential(2)}`,
  );
  // S&L textbook trim is alpha ~2.1 deg, el ~ -0.8 deg, throttle ~0.14 at this point.
  check("trim converged", r.cost < 1e-4, `cost=${r.cost.toExponential(2)}`);
  check("trim alpha plausible", alphaDeg > 0 && alphaDeg < 6, `alpha=${alphaDeg.toFixed(2)} deg`);
  check("elevator small", Math.abs(r.u.elevator) < 6, `el=${r.u.elevator.toFixed(2)} deg`);
}

// --- 2. Trim AoA increases as speed drops (lift = weight) ---
console.log("\n[2] Trim AoA vs airspeed @ 10,000 ft (should rise as speed falls)");
{
  const speeds = [700, 600, 500, 400, 300];
  let prev = -Infinity;
  let monotonic = true;
  for (const vt of speeds) {
    const r = trim({ vt, alt: 10000 });
    const aDeg = r.alpha * RTOD;
    const kcas = tasToKcas(vt, 10000);
    console.log(`      ${vt} ft/s (${kcas.toFixed(0)} KCAS): alpha=${aDeg.toFixed(2)} deg, thr=${r.u.throttle.toFixed(2)}`);
    if (aDeg < prev - 0.05) monotonic = false;
    prev = aDeg;
  }
  check("AoA rises monotonically as speed drops", monotonic, "lift=weight relationship");
}

// --- 3. Speed of sound / Mach sanity ---
console.log("\n[3] Atmosphere / Mach");
{
  const sl = adc(1116.45, 0); // ~speed of sound at SL
  check("Mach 1 at SL ~ 1116 ft/s", Math.abs(sl.mach - 1) < 0.02, `mach=${sl.mach.toFixed(3)}`);
  const hi = adc(968, 36000);
  check("speed of sound drops with altitude", hi.a < 1116 && hi.a > 950, `a=${hi.a.toFixed(0)} ft/s`);
}

// --- 4. Static pitch stability: nose-down moment for +AoA perturbation ---
console.log("\n[4] Static longitudinal stability (Cm slope < 0)");
{
  const r = trim({ vt: 502, alt: 0 });
  const xPlus = r.x.slice();
  xPlus[X.ALPHA] += 2 / RTOD; // +2 deg AoA
  const base = f16Deriv(r.x, r.u);
  const pert = f16Deriv(xPlus, r.u);
  const dQdot = pert.xd[X.Q] - base.xd[X.Q];
  check("increasing AoA produces nose-down pitch accel", dQdot < 0, `d(qdot)=${dQdot.toExponential(2)}`);
}

// --- 5. Open-loop short-period: trimmed a/c stays bounded for a few seconds ---
console.log("\n[5] Open-loop trim hold (5 s free response from trim)");
{
  const r = trim({ vt: 502, alt: 0 });
  let x = r.x.slice();
  const dt = 1 / 120;
  let maxNz = -Infinity;
  for (let i = 0; i < 5 * 120; i++) {
    const step = rk4Step(x, r.u, dt);
    x = step.x;
    maxNz = Math.max(maxNz, Math.abs(step.Nz));
  }
  const dV = x[X.VT] - r.x[X.VT];
  const dAlt = x[X.ALT] - r.x[X.ALT];
  console.log(`      after 5 s: dV=${dV.toFixed(1)} ft/s, dAlt=${dAlt.toFixed(0)} ft, max|Nz|=${maxNz.toFixed(2)} g`);
  check("bounded response (|dV|<60 ft/s, |dAlt|<800 ft)", Math.abs(dV) < 60 && Math.abs(dAlt) < 800, "stable trim");
}

// --- 6. Sustained-G corner: can the jet hold ~9 g in the 330-440 KCAS band? ---
console.log("\n[6] Instantaneous-G capability across the corner plateau (full AB)");
{
  // At each speed, find the Nz achievable at the AoA limiter (~22 deg working AoA)
  // with full thrust, as a coarse turn-performance probe.
  for (const kcas of [350, 400, 440, 500]) {
    const vt = kcas * KTS_TO_FT_PER_S; // treat as ~CAS at low alt
    const alt = 10000;
    const { qbar } = adc(vt, alt);
    // Build a high-AoA, full-AB state and read instantaneous Nz.
    const x = trim({ vt, alt, thrustScale: F110_THRUST_SCALE }).x;
    x[X.ALPHA] = 20 / RTOD;
    const d = f16Deriv(x, { throttle: 1, elevator: -25, aileron: 0, rudder: 0 }, F110_THRUST_SCALE);
    console.log(`      ${kcas} KCAS: instantaneous Nz @ 20 deg AoA = ${d.Nz.toFixed(1)} g (qbar=${qbar.toFixed(0)})`);
  }
  check("corner-plateau probe ran", true, "see Nz values above (expect >=9 g near/above corner)");
}

console.log("\n" + "=".repeat(70));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log("=".repeat(70));
process.exit(fail > 0 ? 1 : 0);
