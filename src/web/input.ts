/**
 * Input: keyboard + gamepad -> X-wing flight controls.
 *
 * Continuous axes (pitch/roll/yaw/throttle/boost) are polled each frame; discrete
 * actions (fire torpedo, lock target, toggle view/S-foils) fire on keydown so a
 * fast tap is never missed. Primary lasers are read as a held state (gunHeld).
 *
 * Keyboard:
 *   W / S (or Up/Down)   pitch  (nose up / down)
 *   A / D (or Left/Right) roll
 *   Q / E                yaw
 *   Shift / Ctrl         throttle up / down
 *   Z                    boost (hold)
 *   Space                fire lasers (hold)
 *   F                    fire proton torpedo
 *   T                    lock nearest TIE
 *   X                    toggle S-foils (attack / cruise)
 *   V                    toggle cockpit / chase view
 */

import type { Controls } from "./ship.ts";

// How fast keyboard axes ramp toward full deflection (higher = snappier).
const KEY_RAMP = 9;
// Expo curve for analog sticks: gentle near centre, full authority at the edge.
const EXPO = 0.55;
function expo(v: number): number {
  return EXPO * v * v * v + (1 - EXPO) * v;
}

export class InputManager {
  private keys = new Set<string>();
  private throttle = 0.55;
  // Smoothed (ramped) keyboard axes — gives an analog feel from on/off keys.
  private smPitch = 0;
  private smRoll = 0;
  private smYaw = 0;

  // Touch / on-screen controls (set by the mobile UI). Axes are -1..1, throttle
  // is absolute 0..1 (or null to leave keyboard in charge), gun/boost are held.
  touch = {
    active: false,
    pitch: 0, roll: 0, yaw: 0,
    throttle: null as number | null,
    gun: false, boost: false,
  };

  onTorpedo: (() => void) | null = null;
  onBomb: (() => void) | null = null;
  onTarget: (() => void) | null = null;
  onView: (() => void) | null = null;
  onSFoils: (() => void) | null = null;
  onFlightAssist: (() => void) | null = null;
  onGear: (() => void) | null = null;
  onVtol: (() => void) | null = null;
  onAutoLock: (() => void) | null = null;
  onFirstGesture: (() => void) | null = null;
  private gestureFired = false;

  attach(el: Window = window): void {
    el.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      const fresh = !this.keys.has(k);
      this.keys.add(k);
      if (!this.gestureFired) { this.gestureFired = true; this.onFirstGesture?.(); }
      if ([" ", "f", "b", "t", "y", "x", "v", "g", "l", "h"].includes(k)) e.preventDefault();
      if (fresh) {
        if (k === "b") this.onBomb?.();
        if (k === "t") this.onTarget?.();
        if (k === "y") this.onAutoLock?.();
        if (k === "x") this.onSFoils?.();
        if (k === "v") this.onView?.();
        if (k === "g") this.onFlightAssist?.();
        if (k === "l") this.onGear?.();
        if (k === "h") this.onVtol?.();
      }
    });
    el.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    el.addEventListener("pointerdown", () => {
      if (!this.gestureFired) { this.gestureFired = true; this.onFirstGesture?.(); }
    });
  }

  private k(...names: string[]): boolean {
    return names.some((n) => this.keys.has(n));
  }

  sample(dt: number): Controls {
    if (this.k("shift")) this.throttle = Math.min(1, this.throttle + 0.6 * dt);
    if (this.k("control", "ctrl")) this.throttle = Math.max(0, this.throttle - 0.6 * dt);

    // --- Keyboard: ramp toward the key target instead of snapping to ±1, so it
    // feels analog (smooth) rather than twitchy. Decays back to centre on release. ---
    let kp = 0, kr = 0, ky = 0;
    if (this.k("w", "arrowup")) kp += 1;
    if (this.k("s", "arrowdown")) kp -= 1;
    if (this.k("d", "arrowright")) kr += 1;
    if (this.k("a", "arrowleft")) kr -= 1;
    if (this.k("e")) ky += 1;
    if (this.k("q")) ky -= 1;
    const ramp = 1 - Math.exp(-dt * KEY_RAMP);
    this.smPitch += (kp - this.smPitch) * ramp;
    this.smRoll += (kr - this.smRoll) * ramp;
    this.smYaw += (ky - this.smYaw) * ramp;
    if (Math.abs(this.smPitch) < 0.002) this.smPitch = 0;
    if (Math.abs(this.smRoll) < 0.002) this.smRoll = 0;
    if (Math.abs(this.smYaw) < 0.002) this.smYaw = 0;
    let pitch = this.smPitch, roll = this.smRoll, yaw = this.smYaw;
    let boost = this.k("z");

    // --- Gamepad: deadzone + EXPO curve (gentle near centre, full at the edge)
    // so fine aiming is possible. The physical stick is already analog. ---
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p) => p);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : v);
      const gpRoll = dz(pad.axes[0] ?? 0);
      const gpPitch = dz(pad.axes[1] ?? 0);
      const gpYaw = dz(pad.axes[2] ?? 0);
      if (gpRoll) roll = expo(gpRoll);
      if (gpPitch) pitch = expo(-gpPitch);
      if (gpYaw) yaw = expo(gpYaw);
      if (pad.buttons[7]?.pressed) boost = true;
    }

    // --- On-screen touch (analog joystick) + expo for finer control. ---
    if (this.touch.active) {
      if (this.touch.pitch) pitch = expo(this.touch.pitch);
      if (this.touch.roll) roll = expo(this.touch.roll);
      if (this.touch.yaw) yaw = expo(this.touch.yaw);
      if (this.touch.boost) boost = true;
      if (this.touch.throttle != null) this.throttle = this.touch.throttle;
    }

    return {
      pitch: Math.max(-1, Math.min(1, pitch)),
      roll: Math.max(-1, Math.min(1, roll)),
      yaw: Math.max(-1, Math.min(1, yaw)),
      throttle: this.throttle,
      boost,
    };
  }

  get gunHeld(): boolean { return this.keys.has(" ") || this.touch.gun; }
}
