/**
 * TIE-fighter squadron: spawning, pursuit AI, and firing. Each TIE is a
 * Combatant (so blaster bolts can hit it) that steers toward the player, leads
 * the shot a little, and fires green bolts when lined up. Dead TIEs explode and
 * award score via the onKill callback.
 */

import * as THREE from "three";
import type { Effects } from "./effects.ts";
import type { Combatant } from "./lasers.ts";
import { buildTIE } from "./tie.ts";

const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const EB = 2600; // enemy bolt speed (for lead solutions)
const _sep = new THREE.Vector3();
const _diff = new THREE.Vector3();

export interface FireFn {
  (origin: THREE.Vector3, dir: THREE.Vector3, ownVel: THREE.Vector3): void;
}

export interface PlayerRef {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  forward: THREE.Vector3; // player nose direction (for evasion)
}

class TIE implements Combatant {
  readonly faction = "enemy" as const;
  readonly radius = 4; // bounding sphere (torpedo blast / ram / lead aiming)
  // Oriented box matched to the model: wide solar panels (x), tall (y), thin (z).
  readonly halfExtents = new THREE.Vector3(6.8, 3.6, 2.6);
  alive = true;
  hp = 12;
  group: THREE.Group;
  vel = new THREE.Vector3();
  velDir = new THREE.Vector3(0, 0, -1);
  speed = 360;
  fireCd = 1 + Math.random() * 2;
  flankPhase = Math.random() * Math.PI * 2;
  jinkPhase = Math.random() * Math.PI * 2;
  state: "engage" | "break" = "engage";
  stateUntil = 0;
  breakDir = new THREE.Vector3();
  burst = 0; // queued extra rounds for a burst

  constructor(public id: number, pos: THREE.Vector3) {
    this.group = buildTIE();
    this.group.position.copy(pos);
  }
  get position(): THREE.Vector3 { return this.group.position; }
  get quaternion(): THREE.Quaternion { return this.group.quaternion; }
  hit(dmg: number): void {
    this.hp -= dmg;
    if (this.hp <= 0) this.alive = false;
  }
}

export class EnemyManager {
  private ties: TIE[] = [];
  private nextId = 1000;
  /** 0..1 difficulty, raised each wave: better aim, faster turns, more fire. */
  skill = 0;

  constructor(
    private root: THREE.Object3D,
    private effects: Effects,
    private onKill: () => void,
  ) {}

  get combatants(): Combatant[] { return this.ties; }
  get aliveCount(): number { return this.ties.length; }

  /** Remove every TIE (used on a full game restart). */
  clearAll(): void {
    for (const t of this.ties) this.root.remove(t.group);
    this.ties.length = 0;
  }

  /** Nearest living TIE to a point (for target lock). */
  nearest(to: THREE.Vector3): TIE | null {
    let best: TIE | null = null;
    let bd = Infinity;
    for (const t of this.ties) {
      const d = t.position.distanceToSquared(to);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  nearestId(to: THREE.Vector3): number | null {
    return this.nearest(to)?.id ?? null;
  }

  /** Live position/velocity of a TIE by id, for lead-aiming and the target box. */
  info(id: number): { position: THREE.Vector3; velocity: THREE.Vector3; radius: number } | null {
    const t = this.ties.find((x) => x.id === id && x.alive);
    return t ? { position: t.position, velocity: t.vel, radius: t.radius } : null;
  }

  spawnWave(n: number, around: THREE.Vector3): void {
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 0.6 - 0.3, Math.random() * 2 - 1).normalize();
      const pos = around.clone().addScaledVector(dir, 2600 + Math.random() * 2200);
      const t = new TIE(this.nextId++, pos);
      this.root.add(t.group);
      this.ties.push(t);
    }
  }

  update(dt: number, t: number, player: PlayerRef, fire: FireFn): void {
    for (let i = this.ties.length - 1; i >= 0; i--) {
      const tie = this.ties[i];
      if (!tie.alive) {
        this.effects.spawnExplosion(tie.position.clone(), 1.4);
        this.effects.spawnDebris(tie.position.clone(), tie.vel.clone(), 8, 0.9);
        this.root.remove(tie.group);
        this.ties.splice(i, 1);
        this.onKill();
        continue;
      }

      const dist = tie.position.distanceTo(player.position);
      const fwd = FORWARD.clone().applyQuaternion(tie.group.quaternion);

      // Proper intercept lead: predict where the player will be when a bolt
      // (relative speed ~EB) arrives, and aim there — TIEs now lead their shots.
      const tHit = dist / EB;
      const lead = player.position.clone().addScaledVector(player.velocity, tHit);
      const toLead = lead.clone().sub(tie.position).normalize();

      // --- Tactics: boom-and-zoom. Close to guns, then break off and re-attack
      // instead of flying into your face (which made them easy).
      if (tie.state === "break") {
        if (t >= tie.stateUntil) tie.state = "engage";
      } else if (dist < 360) {
        tie.state = "break";
        tie.stateUntil = t + 1.3 + Math.random() * 0.7;
        tie.breakDir.copy(fwd)
          .addScaledVector(new THREE.Vector3().crossVectors(fwd, UP).normalize(), Math.random() < 0.5 ? -1.2 : 1.2)
          .addScaledVector(UP, Math.random() < 0.5 ? -0.5 : 0.5)
          .normalize();
      }

      // --- Desired heading ---
      let desired: THREE.Vector3;
      if (tie.state === "break") {
        desired = tie.breakDir.clone();
      } else {
        desired = toLead.clone();
        const toTie = tie.position.clone().sub(player.position).normalize();
        const beingAimed = player.forward.dot(toTie) > 0.95 && dist < 1700;
        const side = new THREE.Vector3().crossVectors(desired, UP).normalize();
        if (beingAimed) {
          // hard evasive jink to spoil the player's gun solution
          const jf = 5 + this.skill * 3;
          desired.addScaledVector(side, Math.sin(t * jf + tie.jinkPhase) * 0.9)
            .addScaledVector(UP, Math.cos(t * (jf * 0.8) + tie.jinkPhase) * 0.5)
            .normalize();
        } else {
          desired.addScaledVector(side, Math.sin(t * 0.8 + tie.flankPhase) * 0.2).normalize();
        }
      }

      // Separation: steer away from close squadmates so the swarm spreads out.
      _sep.set(0, 0, 0);
      for (const o of this.ties) {
        if (o === tie || !o.alive) continue;
        const d2 = tie.position.distanceToSquared(o.position);
        if (d2 < 200 * 200 && d2 > 1) _sep.add(_diff.subVectors(tie.position, o.position).multiplyScalar(1 / d2));
      }
      if (_sep.lengthSq() > 0) desired.add(_sep.normalize().multiplyScalar(0.5)).normalize();

      // Steer toward desired; turn rate climbs with skill (harder to shake).
      const turn = 2.2 + this.skill * 2.2;
      const targetQ = new THREE.Quaternion().setFromUnitVectors(FORWARD, desired);
      tie.group.quaternion.slerp(targetQ, 1 - Math.exp(-dt * turn));

      // Move; faster on the break-off extension.
      const tgtSpeed = tie.state === "break" ? 540 : (dist > 1400 ? 490 : 360);
      tie.speed += (tgtSpeed - tie.speed) * (1 - Math.exp(-dt * 1.8));
      const nf = FORWARD.clone().applyQuaternion(tie.group.quaternion);
      tie.velDir.lerp(nf, 1 - Math.exp(-dt * 3.0)).normalize();
      tie.vel.copy(tie.velDir).multiplyScalar(tie.speed);
      tie.group.position.addScaledVector(tie.vel, dt);

      // --- Fire (only while engaging): lead-aimed, accuracy + cadence scale up ---
      tie.fireCd -= dt;
      if (tie.state === "engage") {
        const aligned = nf.dot(toLead) > 0.992 - this.skill * 0.012;
        const range = 3200 + this.skill * 900;
        if (tie.fireCd <= 0 && dist < range && aligned) {
          const muzzle = tie.position.clone().addScaledVector(nf, 6);
          const spread = 0.022 * (1 - this.skill * 0.6);
          const aimDir = toLead.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread,
          )).normalize();
          fire(muzzle, aimDir, tie.vel);
          if (tie.burst > 0) { tie.burst--; tie.fireCd = 0.12; }
          else { tie.burst = this.skill > 0.5 ? 1 : 0; tie.fireCd = (1.0 - this.skill * 0.45) + Math.random() * 0.6; }
        }
      }
    }
  }
}
