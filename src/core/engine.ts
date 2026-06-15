/**
 * F-16 engine model (Stevens & Lewis `thrust.m`, `tgear.m`, `rtau.m`, `pdot.m`).
 *
 * The engine is modeled as a commanded power level (0..100%) that the actual
 * power level lags through first-order dynamics, feeding a 2-D thrust deck
 * (idle / military / max-augmented) as a function of altitude and Mach.
 *
 * The published deck is representative of the early F-16 (F100-class) engine.
 * The DCS F-16C uses the more powerful F110-GE-129; set `thrustScale > 1` to
 * approximate it while keeping the validated aero/engine coupling intact.
 * F110-GE-129 max augmented ~29,000 lbf vs ~25,000 lbf for the baseline deck,
 * giving a scale of ~1.16.
 */

export const F110_THRUST_SCALE = 1.16;

/** Throttle (0..1) -> commanded power level (0..100%). */
export function tgear(thtl: number): number {
  if (thtl <= 0.77) return 64.94 * thtl;
  return 217.38 * thtl - 117.38;
}

/** Power-lag inverse time constant as a function of power error. */
function rtau(dp: number): number {
  if (dp <= 25) return 1.0;
  if (dp >= 50) return 0.1;
  return 1.9 - 0.036 * dp;
}

/**
 * Rate of change of actual power level given current (p3) and commanded (p1)
 * power. Captures the spool-up/spool-down asymmetry of the real engine.
 * @returns d(pow)/dt
 */
export function pdot(p3: number, p1: number): number {
  let p2: number;
  let t: number;
  if (p1 >= 50) {
    if (p3 >= 50) {
      t = 5.0;
      p2 = p1;
    } else {
      p2 = 60.0;
      t = rtau(p2 - p3);
    }
  } else {
    if (p3 >= 50) {
      t = 5.0;
      p2 = 40.0;
    } else {
      p2 = p1;
      t = rtau(p2 - p3);
    }
  }
  return t * (p2 - p3);
}

// Thrust decks, lbf. Rows = altitude index (0,10,20,30,40,50 kft),
// cols = Mach index (0,0.2,0.4,0.6,0.8,1.0). Transposed from the source so
// THRUST_*[i_alt][m_mach] indexes directly.
const IDLE = [
  [1060, 635, 60, -1020, -2700, -3600],
  [670, 425, 25, -170, -1900, -1400],
  [880, 690, 345, -300, -1300, -595],
  [1140, 1010, 755, 350, -247, -342],
  [1500, 1330, 1130, 910, 600, -200],
  [1860, 1700, 1525, 1360, 1100, 700],
];

const MIL = [
  [12680, 12680, 12610, 12640, 12390, 11680],
  [9150, 9150, 9312, 9839, 10176, 9848],
  [6200, 6313, 6610, 7090, 7750, 8050],
  [3950, 4040, 4290, 4660, 5320, 6100],
  [2450, 2470, 2600, 2840, 3250, 3800],
  [1400, 1400, 1560, 1660, 1930, 2310],
];

const MAX = [
  [20000, 21420, 22700, 24240, 26070, 28886],
  [15000, 15700, 16860, 18910, 21075, 23319],
  [10800, 11225, 12250, 13760, 15975, 18300],
  [7000, 7323, 8154, 9285, 11115, 13484],
  [4000, 4435, 5000, 5700, 6860, 8642],
  [2500, 2600, 2835, 3215, 3950, 5057],
];

/**
 * Engine thrust, lbf.
 * @param pow actual power level, 0..100%
 * @param alt altitude, ft
 * @param mach Mach number
 * @param scale optional thrust multiplier (e.g. F110_THRUST_SCALE)
 */
export function thrust(pow: number, alt: number, mach: number, scale = 1.0): number {
  let rmach = mach;
  if (rmach < 0) rmach = 0;
  if (alt < 0) alt = 0.01;

  const h = 0.0001 * alt;
  let i = Math.trunc(h);
  if (i >= 5) i = 4;
  const dh = h - i;

  const rm = 5 * rmach;
  let m = Math.trunc(rm);
  if (m >= 5) m = 4;
  const dm = rm - m;
  const cdh = 1 - dh;

  // Bilinear interpolation helper over a deck.
  const interp = (deck: number[][]): number => {
    const s = deck[i][m] * cdh + deck[i + 1][m] * dh;
    const t = deck[i][m + 1] * cdh + deck[i + 1][m + 1] * dh;
    return s + (t - s) * dm;
  };

  const tmil = interp(MIL);
  let thrst: number;
  if (pow < 50) {
    const tidl = interp(IDLE);
    thrst = tidl + (tmil - tidl) * pow * 0.02;
  } else {
    const tmax = interp(MAX);
    thrst = tmil + (tmax - tmil) * (pow - 50) * 0.02;
  }
  return thrst * scale;
}
