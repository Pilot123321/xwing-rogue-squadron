/**
 * Closed-loop FLCS verification: commands maneuvers and checks the control
 * laws behave per the manual (g-command, 9 g limit, ~25 deg AoA limiter,
 * roll-rate command, turn coordination, neutral-stick trim hold).
 *
 * Run: `node test/flcs_test.ts`
 */

import { Aircraft } from "../src/core/aircraft.ts";
import { trim } from "../src/core/trim.ts";
import { F110_THRUST_SCALE } from "../src/core/engine.ts";
import { KTS_TO_FT_PER_S } from "../src/core/atmosphere.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail: string) {
  if (cond) pass++; else fail++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

const DT = 1 / 240;

function newAircraftTrimmed(vtKcasLike: number, alt: number) {
  const vt = vtKcasLike * KTS_TO_FT_PER_S;
  const tr = trim({ vt, alt, thrustScale: F110_THRUST_SCALE });
  const ac = new Aircraft({ vt, alt, thrustScale: F110_THRUST_SCALE });
  ac.setState(tr.x);
  return ac;
}

console.log("=".repeat(70));
console.log("F-16 FLCS CLOSED-LOOP VERIFICATION");
console.log("=".repeat(70));

// --- 1. Neutral stick holds level flight (auto-trim) ---
console.log("\n[1] Neutral stick holds 1 g level flight for 10 s");
{
  const ac = newAircraftTrimmed(400, 10000);
  const alt0 = ac.x[11];
  let maxG = 0;
  let t;
  for (let i = 0; i < 10 / DT; i++) {
    t = ac.step({ pitch: 0, roll: 0, yaw: 0, throttle: 0.8 }, DT);
    maxG = Math.max(maxG, Math.abs(t.g - 1));
  }
  const dAlt = ac.x[11] - alt0;
  console.log(`      dAlt=${dAlt.toFixed(0)} ft over 10 s, max|g-1|=${maxG.toFixed(2)}, final g=${t!.g.toFixed(2)}`);
  check("holds altitude within 1500 ft", Math.abs(dAlt) < 1500, `dAlt=${dAlt.toFixed(0)} ft`);
  check("no g excursions > 0.6", maxG < 0.6, `max|g-1|=${maxG.toFixed(2)}`);
}

// --- 2. Commanded pull reaches commanded g (g-command tracking) ---
console.log("\n[2] 80% aft stick commands a high-g pull, settles near commanded g");
{
  const ac = newAircraftTrimmed(500, 15000);
  let g = 1, t;
  for (let i = 0; i < 4 / DT; i++) {
    t = ac.step({ pitch: 0.8, roll: 0, yaw: 0, throttle: 1 }, DT);
    g = t.g;
  }
  // 0.8 aft -> commanded ~ 1 + 0.8*8 = 7.4 g
  console.log(`      steady g=${g.toFixed(2)} (commanded ~7.4), AoA=${t!.alphaDeg.toFixed(1)} deg`);
  check("tracks high-g command within +/-1.5 g", Math.abs(g - 7.4) < 1.5, `g=${g.toFixed(2)}`);
}

// --- 3. Full aft stick does not exceed the 9 g structural limit ---
console.log("\n[3] Full aft stick respects 9 g limit (high speed)");
{
  const ac = newAircraftTrimmed(600, 10000);
  let maxG = 0, t;
  for (let i = 0; i < 5 / DT; i++) {
    t = ac.step({ pitch: 1, roll: 0, yaw: 0, throttle: 1 }, DT);
    maxG = Math.max(maxG, t.g);
  }
  console.log(`      peak g=${maxG.toFixed(2)}, final AoA=${t!.alphaDeg.toFixed(1)} deg`);
  check("peak g <= 9.7 (limit + small overshoot)", maxG <= 9.7, `peak=${maxG.toFixed(2)} g`);
  check("peak g >= 8.5 (can actually reach the limit)", maxG >= 8.5, `peak=${maxG.toFixed(2)} g`);
}

// --- 4. AoA limiter: full aft at low speed caps AoA near 25 deg ---
console.log("\n[4] AoA limiter caps working AoA near 25 deg (low speed)");
{
  const ac = newAircraftTrimmed(200, 15000);
  let maxAoa = 0, t;
  for (let i = 0; i < 8 / DT; i++) {
    t = ac.step({ pitch: 1, roll: 0, yaw: 0, throttle: 1 }, DT);
    maxAoa = Math.max(maxAoa, t.alphaDeg);
  }
  console.log(`      peak AoA=${maxAoa.toFixed(1)} deg (limit 25), final g=${t!.g.toFixed(2)}`);
  check("AoA stays <= 28 deg", maxAoa <= 28, `peak AoA=${maxAoa.toFixed(1)} deg`);
  check("AoA reaches limiter region (>= 20 deg)", maxAoa >= 20, `peak AoA=${maxAoa.toFixed(1)} deg`);
}

// --- 5. Roll-rate command produces roll, bounded ---
console.log("\n[5] Roll command produces a steady roll rate");
{
  const ac = newAircraftTrimmed(450, 15000);
  let maxRoll = 0, t;
  for (let i = 0; i < 2 / DT; i++) {
    t = ac.step({ pitch: 0, roll: 1, yaw: 0, throttle: 0.9 }, DT);
    maxRoll = Math.max(maxRoll, Math.abs(t.pDegS));
  }
  console.log(`      peak roll rate=${maxRoll.toFixed(0)} deg/s (commanded ~308)`);
  check("achieves substantial roll rate (>150 deg/s)", maxRoll > 150, `${maxRoll.toFixed(0)} deg/s`);
  check("roll rate bounded (<360 deg/s)", maxRoll < 360, `${maxRoll.toFixed(0)} deg/s`);
}

// --- 6. Turn coordination: hard turn keeps sideslip small ---
console.log("\n[6] Coordinated turn keeps sideslip small");
{
  const ac = newAircraftTrimmed(450, 15000);
  // Roll into a bank, then hold a pull.
  let t;
  for (let i = 0; i < 0.8 / DT; i++) t = ac.step({ pitch: 0.1, roll: 0.8, yaw: 0, throttle: 1 }, DT);
  let maxBeta = 0;
  for (let i = 0; i < 4 / DT; i++) {
    t = ac.step({ pitch: 0.6, roll: 0, yaw: 0, throttle: 1 }, DT);
    maxBeta = Math.max(maxBeta, Math.abs(t!.betaDeg));
  }
  console.log(`      max |sideslip| during turn = ${maxBeta.toFixed(1)} deg, bank=${t!.phiDeg.toFixed(0)} deg`);
  check("sideslip stays small (< 6 deg)", maxBeta < 6, `max|beta|=${maxBeta.toFixed(1)} deg`);
}

console.log("\n" + "=".repeat(70));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log("=".repeat(70));
process.exit(fail > 0 ? 1 : 0);
