/**
 * F-16C airframe constants.
 *
 * Geometry, mass and inertia are taken from the NASA / Stevens & Lewis
 * "Aircraft Control and Simulation" F-16 model (NASA TP-1538 wind-tunnel data),
 * which is the de-facto public reference for high-fidelity F-16 simulation.
 * The c1..c9 terms are the inertia-coupling coefficients precomputed by
 * Stevens & Lewis from the moments of inertia (see derivation below).
 *
 * All values are in US customary units (ft, slug, lb, s) to match the source
 * aerodynamic dataset. Convert at the boundaries of the sim if you want SI.
 */

// --- Reference geometry ---
export const S = 300.0; // wing reference area, ft^2
export const B = 30.0; // wing span, ft
export const CBAR = 11.32; // mean aerodynamic chord, ft

// Longitudinal CG positions, fraction of CBAR (measured from the same datum).
export const XCG_REF = 0.35; // aerodynamic reference CG of the wind-tunnel data
export const XCG = 0.3; // operational CG (forward of ref -> statically stable)

// --- Mass / inertia ---
// Reference gross weight of the aero dataset, lb. (~20,500 lb clean-ish)
export const WEIGHT = 20500.0;
export const G0 = 32.17; // ft/s^2
export const MASS = WEIGHT / G0; // slug
/** rm = 1 / mass, used as the force->accel multiplier in the EOM. */
export const RM = 1.0 / MASS; // == 1.57e-3 in the source for 20500 lb

// Moments of inertia, slug-ft^2 (Stevens & Lewis Table 3.5-2)
export const IXX = 9496.0;
export const IYY = 55814.0;
export const IZZ = 63100.0;
export const IXZ = 982.0;

// Engine angular momentum about the body x-axis, slug-ft^2/s (spinning rotor).
export const HE = 160.0;

export const RTOD = 57.29577951308232; // rad -> deg

/**
 * Inertia-coupling coefficients (Stevens & Lewis eq. 1.7-18).
 * These appear directly in the rotational EOM. They are written here as the
 * literal constants used by the reference model so behavior matches exactly,
 * with the symbolic derivation shown for documentation.
 *
 *   gam = Ixx*Izz - Ixz^2
 *   c1 = ((Iyy-Izz)*Izz - Ixz^2)/gam
 *   c2 = (Ixx-Iyy+Izz)*Ixz/gam
 *   c3 = Izz/gam
 *   c4 = Ixz/gam
 *   c5 = (Izz-Ixx)/Iyy
 *   c6 = Ixz/Iyy
 *   c7 = 1/Iyy
 *   c8 = (Ixx*(Ixx-Iyy)+Ixz^2)/gam
 *   c9 = Ixx/gam
 */
export const C1 = -0.77;
export const C2 = 0.02755;
export const C3 = 1.055e-4;
export const C4 = 1.642e-6;
export const C5 = 0.9604;
export const C6 = 1.759e-2;
export const C7 = 1.792e-5;
export const C8 = -0.7336;
export const C9 = 1.587e-5;

// --- Control-surface travel limits (deg), per the F-16 FLCS / Morelli model ---
export const ELEV_LIMIT = 25.0; // horizontal stabilator (symmetric), deg
export const AIL_LIMIT = 21.5; // flaperon differential, deg
export const RDR_LIMIT = 30.0; // rudder, deg

// --- FLCS envelope limits (from the DCS F-16C Early Access Guide) ---
export const G_LIMIT_POS = 9.0; // structural symmetric positive limit, g
export const G_LIMIT_NEG = -3.0; // negative limit, g
export const AOA_LIMIT = 25.0; // command AoA limiter ceiling, deg
export const AOA_ONSPEED_LO = 11.1; // AoA indexer "on speed" lower bound, deg
export const AOA_ONSPEED_HI = 13.9; // AoA indexer "on speed" upper bound, deg
