/**
 * Newtonian 6-DOF space flight model for the player's X-wing.
 *
 * Real-world space physics: there is no air, so there is no drag and nothing
 * stops you — linear velocity and angular momentum both persist until a thruster
 * changes them. The main engine produces thrust (acceleration) along the nose;
 * RCS thrusters produce torque. To slow down you must turn around and burn, or
 * engage Flight Assist (RCS dampers).
 *
 *   Flight Assist ON  (RCS dampers, default): rate-commanded rotation that stops
 *     when you release the stick, and translational thrusters that drive your
 *     velocity toward (throttle * cruise) along the nose. Realistic fly-by-wire.
 *   Flight Assist OFF (pure Newtonian): control inputs apply torque only; spin
 *     and drift persist. The main engine only pushes along the nose. You carry
 *     all your momentum and must cancel it manually.
 *
 * Forward is the ship's local -Z. World is Three.js right-handed, +Y up. Units
 * are metres, seconds, m/s, m/s^2, rad/s.
 */

import * as THREE from "three";
import { buildXWing, type XWing } from "./xwing.ts";

export interface Controls {
  pitch: number; // -1..1, positive = pull nose up
  roll: number; // -1..1, positive = roll right
  yaw: number; // -1..1, positive = yaw right
  throttle: number; // 0..1 main-engine throttle
  boost: boolean; // sublight accelerator
}

const FORWARD = new THREE.Vector3(0, 0, -1);

export const CRUISE_SPEED = 480; // assisted target speed at full throttle
export const MAX_SPEED = CRUISE_SPEED; // HUD scaling reference
export const BOOST_SPEED = 1100; // sublight accelerator assisted target

const VTOL_SPEED = 130; // m/s vertical rate at full VTOL throttle
const MAIN_ACCEL = 70; // m/s^2, main engine at full throttle
const BOOST_ACCEL = 230; // m/s^2, sublight accelerator
const RCS_LIN = 60; // m/s^2, RCS translational authority (assist only)

// Rotational authority (pitch about X, yaw about Y, roll about Z).
const ANG_ACCEL = new THREE.Vector3(2.4, 1.4, 4.8); // rad/s^2 (assist off: torque)
const MAX_RATE = new THREE.Vector3(1.3, 0.85, 3.0); // rad/s (assist on: rate caps)

// --- Atmospheric flight (only inside the planet's atmosphere) ---
// Hornet-flavoured handling numbers from the F/A-18C guide: an AoA on-speed bracket,
// a structural G limit, a corner speed, and a stall AoA. We don't have aero
// coefficients (the guide is a pilot manual), so this is an arcade model shaped
// to those limits, not a true 6-DOF aero sim.
const DEG = Math.PI / 180;
const ONSPEED_AOA = 8.1 * DEG; // Hornet on-speed AoA
const STALL_AOA = 22 * DEG; // departs/loses lift past here
const G_LIMIT = 7.5; // structural limit
const CORNER_SPEED = 300; // m/s where full G is available
// Drag tuned so it BALANCES thrust at a sensible top speed (~460 m/s at full
// throttle) instead of overwhelming gravity — so a dive actually accelerates.
const AIR_DRAG = 0.14; // drag coefficient (fraction of speed shed/s at ref speed)
const DRAG_REF = 420; // reference airspeed for drag scaling
const G_ACCEL = 9.81;

export class PlayerShip {
  readonly model: XWing;
  readonly group: THREE.Group;
  /** Linear velocity in world space (m/s). Persists — this is real momentum. */
  readonly vel = new THREE.Vector3(0, 0, -200);
  /** Angular velocity in the body frame (rad/s). Persists when assist is off. */
  readonly angVel = new THREE.Vector3();
  flightAssist = true;
  /** True when the sublight accelerator actually engaged this frame. */
  boosting = false;
  gearDown = false;
  vtol = false; // vertical-thrust hover mode for landing / takeoff

  // Atmospheric telemetry (valid when in air; for the HUD AoA/G cues).
  aoaDeg = 0;
  gLoad = 1;
  stalled = false;
  inAtmo = false;

  private sfoils = 1;
  private sfoilsTarget = 1;
  private _nose = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private _axis = new THREE.Vector3();
  private _v = new THREE.Vector3();

  constructor() {
    this.model = buildXWing();
    // Wrap the model so the exterior hull can be toggled independently of the
    // cockpit-interior geometry parented to the same root.
    this.group = new THREE.Group();
    this.group.add(this.model.group);
  }

  /** Hide/show the exterior X-wing (used for the first-person cockpit view). */
  setExteriorVisible(v: boolean): void { this.model.group.visible = v; }

  toggleSFoils(): void { this.sfoilsTarget = this.sfoilsTarget > 0.5 ? 0 : 1; }
  get sfoilsOpen(): boolean { return this.sfoilsTarget > 0.5; }
  toggleFlightAssist(): void { this.flightAssist = !this.flightAssist; }
  toggleGear(): void { this.gearDown = !this.gearDown; this.model.setGear(this.gearDown); }
  toggleVtol(): void { this.vtol = !this.vtol; }

  get speed(): number { return this.vel.length(); }

  /** Reset motion after a respawn (point velocity straight ahead, kill spin). */
  resetMotion(speed: number): void {
    this.forward(this.vel).multiplyScalar(speed);
    this.angVel.set(0, 0, 0);
  }

  /** How far the velocity vector is off the nose (0 = aligned, 1 = 90deg+). */
  get slip(): number {
    const s = this.vel.length();
    if (s < 1e-3) return 0;
    return 1 - Math.max(0, this.forward(this._nose).dot(this._v.copy(this.vel).divideScalar(s)));
  }

  /** Nose direction in world space. */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(FORWARD).applyQuaternion(this.group.quaternion);
  }
  velocity(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.vel);
  }

  /** World-space muzzle points for the four wingtip cannons. */
  muzzles(): THREE.Vector3[] {
    return this.model.cannonTips.map((p) =>
      p.clone().applyQuaternion(this.group.quaternion).add(this.group.position));
  }

  update(c: Controls, dt: number, atmo = 0): void {
    // HOTAS pitch convention: push forward (W, pitch+) = nose down.
    const wishX = -c.pitch, wishY = -c.yaw, wishZ = -c.roll;

    // S-foils set the trade-off: open = attack (agile, no sublight); folded =
    // cruise (sublight accelerator available, but less maneuverable).
    const wingsFolded = this.sfoils < 0.3;
    const boost = c.boost && wingsFolded;
    this.boosting = boost;
    let agility = 0.5 + 0.5 * this.sfoils; // folded ~0.5x, full attack 1.0x

    // --- Atmospheric handling (only meaningful inside the planet's air) ---
    const sp0 = this.vel.length();
    const noseS = this.forward(this._nose);
    // Angle of attack: angle between the nose and the velocity vector.
    let aoa = 0;
    if (sp0 > 5) aoa = Math.acos(Math.max(-1, Math.min(1, noseS.dot(this._v.copy(this.vel).divideScalar(sp0)))));
    this.aoaDeg = aoa / DEG;
    this.inAtmo = atmo > 0.02;
    this.stalled = atmo > 0.1 && aoa > STALL_AOA && sp0 < CORNER_SPEED * 1.2;

    // --- Rotation ---
    // In air, the achievable pitch/yaw rate is capped by structural G at speed
    // and by available lift at low speed (you need airspeed to turn). In vacuum
    // the RCS gives the full rate. Roll is unaffected.
    let rateX = MAX_RATE.x, rateY = MAX_RATE.y;
    if (atmo > 0) {
      const speedF = Math.min(1, sp0 / CORNER_SPEED) * (this.stalled ? 0.25 : 1);
      const gRate = (G_LIMIT * G_ACCEL) / Math.max(50, sp0); // structural-G rate cap
      const airX = Math.min(MAX_RATE.x, gRate) * speedF;
      const airY = Math.min(MAX_RATE.y, gRate) * speedF;
      rateX = MAX_RATE.x * (1 - atmo) + airX * atmo;
      rateY = MAX_RATE.y * (1 - atmo) + airY * atmo;
    }
    if (this.flightAssist) {
      const k = 1 - Math.exp(-dt * 7);
      this.angVel.x += (wishX * rateX * agility - this.angVel.x) * k;
      this.angVel.y += (wishY * rateY * agility - this.angVel.y) * k;
      this.angVel.z += (wishZ * MAX_RATE.z * agility - this.angVel.z) * k;
    } else {
      this.angVel.x += wishX * ANG_ACCEL.x * agility * dt;
      this.angVel.y += wishY * ANG_ACCEL.y * agility * dt;
      this.angVel.z += wishZ * ANG_ACCEL.z * agility * dt;
    }
    // Instantaneous turn G (for the HUD).
    this.gLoad = 1 + Math.hypot(this.angVel.x, this.angVel.y) * sp0 / G_ACCEL;
    const w = this.angVel.length();
    if (w > 1e-6) {
      this._axis.copy(this.angVel).multiplyScalar(1 / w);
      this._q.setFromAxisAngle(this._axis, w * dt);
      this.group.quaternion.multiply(this._q);
    }

    // --- Translation (unified, density-aware) ---
    const nose = this.forward(this._nose);
    if (this.vtol) {
      const climb = (c.throttle - 0.5) * 2 * VTOL_SPEED;
      const dv = this._v.set(0, climb, 0).sub(this.vel);
      const maxDV = (MAIN_ACCEL + RCS_LIN) * dt;
      if (dv.length() > maxDV) dv.setLength(maxDV);
      this.vel.add(dv);
    } else {
      const sp = this.vel.length();

      // 1) FLIGHT PATH follows the nose. In space this is the RCS (flight assist)
      //    realign; in air it's aerodynamic LIFT, which needs airspeed and dies
      //    in a stall. Newtonian-in-space keeps pure momentum (no realign).
      let alignRate = 0;
      if (atmo > 0) {
        const liftAuth = Math.min(1, sp / CORNER_SPEED) * (this.stalled ? 0.12 : 1);
        alignRate = 3.2 * liftAuth; // aerodynamic lift
        if (this.flightAssist) alignRate = Math.max(alignRate, 1.0); // RCS assist helps a bit
      } else if (this.flightAssist) {
        alignRate = 2.6; // space RCS
      }
      if (sp > 1 && alignRate > 0) {
        const dir = this._v.copy(this.vel).divideScalar(sp)
          .lerp(nose, 1 - Math.exp(-dt * alignRate)).normalize();
        this.vel.copy(dir).multiplyScalar(sp); // redirect, preserve speed (gravity adds energy separately)
      }

      // 2) THRUST along the nose.
      const accel = boost ? BOOST_ACCEL : c.throttle * MAIN_ACCEL;
      this.vel.addScaledVector(nose, accel * dt);

      // 3) Speed limiting: in AIR, quadratic drag sets the thrust-vs-airspeed top
      //    speed (and bleeds energy when you chop throttle / in hard turns). In
      //    SPACE, a soft cap under flight assist; pure coast when assist is off.
      const sp2 = this.vel.length();
      if (atmo > 0) {
        const drag = AIR_DRAG * atmo * (sp2 / DRAG_REF);
        this.vel.multiplyScalar(Math.max(0, 1 - drag * dt));
      } else if (this.flightAssist && !boost) {
        const cap = CRUISE_SPEED * 1.03;
        if (sp2 > cap) this.vel.multiplyScalar(cap / sp2);
      }
    }
    this.group.position.addScaledVector(this.vel, dt);

    // --- S-foils + engine glow ---
    this.sfoils += (this.sfoilsTarget - this.sfoils) * (1 - Math.exp(-dt * 6));
    this.model.setSFoils(this.sfoils);
    this.model.setThrottle(boost ? 1 : 0.3 + c.throttle * 0.7);
  }
}
