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

  update(c: Controls, dt: number): void {
    // HOTAS pitch convention: push forward (W, pitch+) = nose down.
    const wishX = -c.pitch, wishY = -c.yaw, wishZ = -c.roll;

    // S-foils set the trade-off: open = attack (agile, no sublight); folded =
    // cruise (sublight accelerator available, but less maneuverable).
    const wingsFolded = this.sfoils < 0.3;
    const boost = c.boost && wingsFolded;
    this.boosting = boost;
    const agility = 0.5 + 0.5 * this.sfoils; // folded ~0.5x, full attack 1.0x

    // --- Rotation ---
    if (this.flightAssist) {
      // RCS rate command: chase the commanded body rates, stop when released.
      const k = 1 - Math.exp(-dt * 7);
      this.angVel.x += (wishX * MAX_RATE.x * agility - this.angVel.x) * k;
      this.angVel.y += (wishY * MAX_RATE.y * agility - this.angVel.y) * k;
      this.angVel.z += (wishZ * MAX_RATE.z * agility - this.angVel.z) * k;
    } else {
      // Pure torque: angular momentum accumulates and persists.
      this.angVel.x += wishX * ANG_ACCEL.x * agility * dt;
      this.angVel.y += wishY * ANG_ACCEL.y * agility * dt;
      this.angVel.z += wishZ * ANG_ACCEL.z * agility * dt;
    }
    // Integrate orientation from body-frame angular velocity.
    const w = this.angVel.length();
    if (w > 1e-6) {
      this._axis.copy(this.angVel).multiplyScalar(1 / w);
      this._q.setFromAxisAngle(this._axis, w * dt);
      this.group.quaternion.multiply(this._q); // body-frame (right-multiply)
    }

    // --- Translation ---
    const nose = this.forward(this._nose);
    if (this.vtol) {
      // VTOL hover: throttle 0.5 = hover, >0.5 climb, <0.5 descend; RCS kills
      // horizontal drift so you can settle straight onto a pad and lift off.
      const climb = (c.throttle - 0.5) * 2 * VTOL_SPEED;
      const dv = this._v.set(0, climb, 0).sub(this.vel);
      const maxDV = (MAIN_ACCEL + RCS_LIN) * dt;
      if (dv.length() > maxDV) dv.setLength(maxDV);
      this.vel.add(dv);
    } else if (this.flightAssist) {
      // Throttle is THRUST: the engine accelerates you along the nose and speed
      // builds up over time (momentum preserved, gravity adds on top), with a
      // soft top-speed cap. At idle, RCS gently brakes residual drift.
      const accel = boost ? BOOST_ACCEL : c.throttle * MAIN_ACCEL;
      this.vel.addScaledVector(nose, accel * dt);
      const cap = boost ? BOOST_SPEED : CRUISE_SPEED;
      const sp = this.vel.length();
      if (sp > cap) this.vel.multiplyScalar(cap / sp); // aerodynamic-style soft cap
      if (!boost && c.throttle < 0.05) this.vel.multiplyScalar(Math.max(0, 1 - 1.4 * dt)); // RCS idle brake
    } else {
      // Pure thrust along the nose; velocity is otherwise untouched (momentum).
      const a = boost ? BOOST_ACCEL : c.throttle * MAIN_ACCEL;
      this.vel.addScaledVector(nose, a * dt);
    }
    this.group.position.addScaledVector(this.vel, dt);

    // --- S-foils + engine glow ---
    this.sfoils += (this.sfoilsTarget - this.sfoils) * (1 - Math.exp(-dt * 6));
    this.model.setSFoils(this.sfoils);
    this.model.setThrottle(boost ? 1 : 0.3 + c.throttle * 0.7);
  }
}
