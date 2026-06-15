/**
 * F-16C Block 50 Flight Control System (digital fly-by-wire), modeled to match
 * the behavior described in the DCS F-16C Early Access Guide:
 *
 *  - Pitch: a normal-acceleration (g) command system. Neutral stick commands
 *    1 g (holds flight path / auto-trims). Full aft commands the structural
 *    limit (+9 g), full forward -3 g, with an angle-of-attack limiter that
 *    overrides the g-command so working AoA cannot exceed ~25 deg. There is no
 *    usable high-alpha region (the limiter is the hard ceiling).
 *  - Roll: a roll-rate command system. Stick deflection commands a roll rate
 *    up to ~308 deg/s, closed around measured body roll rate.
 *  - Yaw: a yaw damper plus aileron-rudder interconnect (ARI) for turn
 *    coordination, with rudder-pedal authority summed in.
 *  - Manual Pitch Override (MPO): bypasses the limiters and feeds the stick
 *    directly to the stabilators with full authority for deep-stall recovery;
 *    SSC roll and yaw are inhibited but rudder-pedal yaw is retained.
 *
 * The controller is digital: it reads sensor feedback (with the usual one-step
 * delay supplied by the airframe loop) and outputs surface commands in degrees.
 */

import {
  ELEV_LIMIT, AIL_LIMIT, RDR_LIMIT,
  G_LIMIT_POS, G_LIMIT_NEG, AOA_LIMIT, RTOD,
} from "./constants.ts";

/** Pilot inceptor inputs. pitch/roll/yaw in [-1, 1]; throttle in [0, 1]. */
export interface StickInput {
  pitch: number; // + = aft (pull / nose up)
  roll: number; // + = right
  yaw: number; // + = right rudder pedal
  throttle: number;
}

/** Sensor feedback the FLCS reads each frame. */
export interface Sensors {
  Nz: number; // body normal load factor minus 1 g (level flight = 0)
  alphaDeg: number;
  betaDeg: number;
  p: number; // roll rate, rad/s
  q: number; // pitch rate, rad/s
  r: number; // yaw rate, rad/s
  vt: number; // ft/s
}

export interface SurfaceCommands {
  throttle: number;
  elevator: number; // deg
  aileron: number; // deg
  rudder: number; // deg
  /** Scheduled leading-edge flap deflection, deg (informational/visual). */
  lef: number;
}

export interface FlcsState {
  mpo: boolean; // Manual Pitch Override engaged
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Max commanded roll rate, rad/s (~308 deg/s clean).
const ROLL_RATE_MAX = 308 / RTOD;

export class FLCS {
  // --- Pitch g-command gains (elevator deg per unit) ---
  private kpNz = 4.0; // P on Nz error
  private kiNz = 6.0; // I on Nz error (provides auto-trim)
  private kqPitch = 8.0; // pitch-rate damping (deg per rad/s)

  // --- AoA limiter gains (drives an elevator that holds AoA at the ceiling) ---
  // Proportional + rate-lead (no integral): the limiter only needs to cap AoA,
  // not null steady-state error, and avoiding an integrator prevents the
  // wind-up overshoot that would let AoA blow past the ceiling transiently.
  private kpAoa = 6.0;
  private kAoaLead = 14.0; // lead on AoA rate (q proxy), deg per rad/s
  private aoaSoft = 2.0; // begin limiting this many deg before the hard ceiling

  // --- Roll gains ---
  private kpRoll = 10.0; // aileron deg per (rad/s) roll-rate error

  // --- Yaw gains (damper + coordination) ---
  private kr = 6.0; // yaw-rate damping
  private kBeta = 3.0; // sideslip suppression
  private ari = 0.08; // aileron-rudder interconnect ratio

  // Integrator states.
  private nzInt = 0;

  reset(): void {
    this.nzInt = 0;
  }

  /**
   * Compute surface commands for one frame.
   * @param dt frame time, s
   */
  update(s: Sensors, stick: StickInput, dt: number, state: FlcsState): SurfaceCommands {
    const lef = this.schedLEF(s.alphaDeg);

    if (state.mpo) {
      // Direct stabilator authority; SSC roll/yaw inhibited, pedals keep yaw.
      this.reset();
      return {
        throttle: clamp(stick.throttle, 0, 1),
        elevator: clamp(-stick.pitch * ELEV_LIMIT, -ELEV_LIMIT, ELEV_LIMIT),
        aileron: 0,
        rudder: clamp(stick.yaw * RDR_LIMIT, -RDR_LIMIT, RDR_LIMIT),
        lef,
      };
    }

    // ----- PITCH: g-command with AoA limiting -----
    // Map stick to a commanded total load factor, then to our Nz convention.
    const nCmdTotal =
      stick.pitch >= 0
        ? 1 + stick.pitch * (G_LIMIT_POS - 1)
        : 1 + stick.pitch * (1 - G_LIMIT_NEG);
    const nzTarget = nCmdTotal - 1; // level flight target = 0

    // g controller: nose-up requires more negative elevator, so negate the
    // proportional/integral terms; add pitch-rate damping (opposes +q).
    const nzErr = nzTarget - s.Nz;
    this.nzInt = clamp(this.nzInt + nzErr * dt, -10, 10);
    const eg = -(this.kpNz * nzErr + this.kiNz * this.nzInt) + this.kqPitch * s.q;

    // AoA limiter: an independent controller that holds AoA at the ceiling.
    // Use the hard ceiling minus a soft margin so limiting begins slightly
    // early, with a strong rate-lead term (q ~ AoA rate) to kill overshoot.
    const aoaErr = AOA_LIMIT - this.aoaSoft - s.alphaDeg;
    const ea = -(this.kpAoa * aoaErr) + this.kAoaLead * s.q;

    // Take the less-nose-up of the two (max == less negative): the limiter can
    // only ever restrict nose-up authority, never add it.
    let elevator = Math.max(eg, ea);
    elevator = clamp(elevator, -ELEV_LIMIT, ELEV_LIMIT);

    // ----- ROLL: roll-rate command -----
    const pCmd = stick.roll * ROLL_RATE_MAX;
    const pErr = pCmd - s.p;
    // Positive aileron produces a left roll moment in this aero model, so a
    // right-roll-rate error needs negative aileron.
    let aileron = clamp(-this.kpRoll * pErr, -AIL_LIMIT, AIL_LIMIT);

    // ----- YAW: damper + ARI + pedals -----
    const betaRad = s.betaDeg / RTOD;
    const rudderDamp = this.kr * s.r + this.kBeta * betaRad;
    const ariTerm = this.ari * aileron; // help coordinate the turn
    let rudder = clamp(rudderDamp - ariTerm + stick.yaw * RDR_LIMIT, -RDR_LIMIT, RDR_LIMIT);

    return {
      throttle: clamp(stick.throttle, 0, 1),
      elevator,
      aileron,
      rudder,
      lef,
    };
  }

  /**
   * Leading-edge flap schedule. Auto-scheduled with AoA (and Mach in the real
   * jet); here a simple AoA schedule between 0 and ~25 deg, informational only
   * since the Morelli aero dataset already represents the auto-flap config.
   */
  private schedLEF(alphaDeg: number): number {
    return clamp(1.38 * alphaDeg - 9.05 * 0 /* (Mach term omitted) */, 0, 25);
  }
}
