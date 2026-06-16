/**
 * Destructible air-to-ground targets for the Death Star trench run: turbo-laser
 * turrets lining the trench, and the thermal EXHAUST PORT at the end — the
 * mission objective. Each target is a Combatant (so player lasers and the
 * laser-guided bomb hit it). Destroying the exhaust port is the big payoff.
 */

import * as THREE from "three";
import type { Effects } from "./effects.ts";
import type { Combatant } from "./lasers.ts";
import { DS_SPHERE_R, DS_SPHERE_CENTER, DS_TRENCH_DEPTH, DS_TRENCH_W } from "./surface.ts";

const UP = new THREE.Vector3(0, 1, 0);

const TURRET = new THREE.MeshStandardMaterial({ color: 0x6a6f77, metalness: 0.6, roughness: 0.45 });
const BARREL = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.6, roughness: 0.4 });
const PORT_RING = new THREE.MeshStandardMaterial({ color: 0x55595f, metalness: 0.7, roughness: 0.4 });

class Target implements Combatant {
  readonly faction = "enemy" as const;
  readonly quaternion = new THREE.Quaternion(); // static (identity)
  alive = true;
  fireCd = 1 + Math.random() * 2;
  head: THREE.Object3D | null = null; // rotating turret head (aims at player)
  constructor(
    public id: number,
    public group: THREE.Group,
    public radius: number,
    public halfExtents: THREE.Vector3,
    public hp: number,
    public isPort: boolean,
  ) {}
  get position(): THREE.Vector3 { return this.group.position; }
  hit(dmg: number): void {
    this.hp -= dmg;
    if (this.hp <= 0) this.alive = false;
  }
}

export interface FireFn {
  (origin: THREE.Vector3, dir: THREE.Vector3): void;
}
export interface PlayerRef {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
}

const TURRET_RANGE = 4200; // turrets engage the player within this
const TURRET_BOLT = 2400; // turret bolt speed (for lead)
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();

export class GroundTargets {
  private targets: Target[] = [];
  private nextId = 5000;
  /** Fires when the exhaust port is destroyed (mission complete). */
  onPortDestroyed: (() => void) | null = null;

  constructor(
    private root: THREE.Object3D,
    private effects: Effects,
    private onKill: (score: number) => void,
  ) {
    this.build();
  }

  get combatants(): Combatant[] { return this.targets; }

  /** A point on the equatorial trench floor at angle a, oriented radially out. */
  private grooveSpot(a: number, depthFactor = 0.55): { pos: THREE.Vector3; q: THREE.Quaternion } {
    const r = DS_SPHERE_R - DS_TRENCH_DEPTH * depthFactor;
    const radial = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const pos = DS_SPHERE_CENTER.clone().addScaledVector(radial, r);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, radial); // "up" points out of the trench
    return { pos, q };
  }

  private build(): void {
    // Big turbo-laser turrets lining BOTH rims of the equatorial trench, so they
    // flank the corridor and are clearly visible when you fly the run. They aim
    // and fire at the player.
    const N = 26;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      if (Math.abs(a) < 0.14) continue; // leave a gap at the exhaust port
      const radial = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const q = new THREE.Quaternion().setFromUnitVectors(UP, radial);
      for (const side of [-1, 1]) {
        const g = new THREE.Group();
        const base = new THREE.Mesh(new THREE.CylinderGeometry(120, 150, 220, 18), TURRET);
        base.position.y = 110; g.add(base);
        const head = new THREE.Mesh(new THREE.SphereGeometry(130, 18, 14), TURRET);
        head.position.y = 250; g.add(head);
        const barrels = new THREE.Group();
        for (const bx of [-45, 45]) {
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 300, 12), BARREL);
          barrel.rotation.x = Math.PI / 2;
          barrel.position.set(bx, 0, -150); barrels.add(barrel);
        }
        barrels.position.y = 250; g.add(barrels);
        // place on the rim: radial out to the surface, offset ±W along the trench axis
        g.position.copy(DS_SPHERE_CENTER).addScaledVector(radial, DS_SPHERE_R - 60);
        g.position.y += side * (DS_TRENCH_W + 60);
        g.quaternion.copy(q);
        this.root.add(g);
        const tgt = new Target(this.nextId++, g, 150, new THREE.Vector3(170, 260, 170), 24, false);
        tgt.head = barrels;
        this.targets.push(tgt);
      }
    }

    // The thermal exhaust port — recessed glowing target set into the trench floor.
    const port = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(150, 38, 12, 28), PORT_RING);
    ring.rotation.x = Math.PI / 2; port.add(ring);
    const wellGlow = new THREE.Mesh(new THREE.CircleGeometry(140, 28),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.5, 0.4), toneMapped: false }));
    wellGlow.rotation.x = -Math.PI / 2; wellGlow.position.y = 4; port.add(wellGlow);
    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(280, 14, 22), PORT_RING);
      slat.position.set(0, 10, -95 + i * 64); port.add(slat);
    }
    const ps = this.grooveSpot(0, 0.95);
    port.position.copy(ps.pos); port.quaternion.copy(ps.q);
    this.root.add(port);
    this.targets.push(new Target(this.nextId++, port, 180, new THREE.Vector3(190, 100, 190), 60, true));
  }

  update(dt: number, player: PlayerRef, fire: FireFn): void {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (!t.alive) {
        this.effects.spawnExplosion(t.position.clone(), t.isPort ? 4.0 : 1.6);
        this.effects.spawnDebris(t.position.clone(), new THREE.Vector3(), t.isPort ? 24 : 8, t.isPort ? 2.0 : 1.0);
        this.root.remove(t.group);
        this.onKill(t.isPort ? 1000 : 150);
        if (t.isPort) this.onPortDestroyed?.();
        this.targets.splice(i, 1);
        continue;
      }
      // Turret AI: aim the head at the player and fire lead-corrected bolts.
      if (t.isPort) continue;
      const dist = t.position.distanceTo(player.position);
      if (dist > TURRET_RANGE) continue;
      const tHit = dist / TURRET_BOLT;
      const aim = _v0.copy(player.position).addScaledVector(player.velocity, tHit); // lead
      if (t.head) t.head.lookAt(aim); // swivel barrels toward the target
      t.fireCd -= dt;
      if (t.fireCd <= 0) {
        const dir = _v1.copy(aim).sub(t.position).normalize();
        const muzzle = t.position.clone().addScaledVector(dir, 280).setY(t.position.y + 250);
        fire(muzzle, dir);
        t.fireCd = 1.4 + Math.random() * 1.4;
      }
    }
  }
}
