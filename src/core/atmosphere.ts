/**
 * Air-data computer: standard atmosphere model used by the reference F-16
 * dataset (Stevens & Lewis `adc.m`). Simple two-layer ISA approximation in
 * US units (ft, slug/ft^3, lb/ft^2).
 */

export interface AirData {
  /** Mach number (dimensionless). */
  mach: number;
  /** Dynamic pressure qbar = 0.5 * rho * V^2, lb/ft^2. */
  qbar: number;
  /** Air density, slug/ft^3. */
  rho: number;
  /** Static temperature, deg R. */
  temp: number;
  /** Speed of sound, ft/s. */
  a: number;
}

const RHO0 = 2.377e-3; // sea-level density, slug/ft^3
const GAMMA_R = 1.4 * 1716.3; // gamma * R, for speed of sound

/**
 * @param vt true airspeed, ft/s
 * @param alt altitude, ft
 */
export function adc(vt: number, alt: number): AirData {
  const tfac = 1 - 0.703e-5 * alt;
  let temp = 519.0 * tfac;
  if (alt >= 35000) temp = 390.0; // isothermal above the tropopause
  const rho = RHO0 * Math.pow(tfac, 4.14);
  const a = Math.sqrt(GAMMA_R * temp);
  const mach = vt / a;
  const qbar = 0.5 * rho * vt * vt;
  return { mach, qbar, rho, temp, a };
}

/** True airspeed (ft/s) -> calibrated airspeed (kts), approximate. */
export function tasToKcas(vt: number, alt: number): number {
  const { rho } = adc(vt, alt);
  // Equivalent airspeed approximation (EAS ~ CAS at the speeds we care about).
  const veas = vt * Math.sqrt(rho / RHO0);
  return veas / 1.68781; // ft/s -> kts
}

export const FT_PER_S_TO_KTS = 1 / 1.68781;
export const KTS_TO_FT_PER_S = 1.68781;
