/**
 * Destructible air-to-ground targets for the Death Star trench run: turbo-laser
 * turrets lining the trench, and the thermal EXHAUST PORT at the end — the
 * mission objective. Each target is a Combatant (so player lasers and the
 * laser-guided bomb hit it). Destroying the exhaust port is the big payoff.
 */

import * as THREE from "three";
import type { Effects } from "./effects.ts";
import type { Combatant } from "./lasers.ts";
import { DS_CENTER, DS_TRENCH_HALF, DS_TRENCH_FLOOR, DS_Y, EXHAUST_PORT } from "./surface.ts";

const TURRET = new THREE.MeshStandardMaterial({ color: 0x6a6f77, metalness: 0.6, roughness: 0.45 });
const BARREL = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.6, roughness: 0.4 });
const PORT_RING = new THREE.MeshStandardMaterial({ color: 0x55595f, metalness: 0.7, roughness: 0.4 });

class Target implements Combatant {
  readonly faction = "enemy" as const;
  readonly quaternion = new THREE.Quaternion(); // static (identity)
  alive = true;
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

  private build(): void {
    // Turbo-laser turrets along both trench rims.
    for (let i = -6; i <= 6; i++) {
      if (i === 0) continue;
      for (const side of [-1, 1]) {
        const g = new THREE.Group();
        const base = new THREE.Mesh(new THREE.CylinderGeometry(70, 90, 120, 16), TURRET);
        base.position.y = 60; g.add(base);
        const head = new THREE.Mesh(new THREE.SphereGeometry(75, 16, 12), TURRET);
        head.position.y = 150; g.add(head);
        for (const bx of [-30, 30]) {
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 180, 10), BARREL);
          barrel.rotation.z = Math.PI / 2 - 0.3;
          barrel.position.set(bx, 160, -90); g.add(barrel);
        }
        g.position.set(DS_CENTER.x + i * 1100, DS_Y + 5, DS_CENTER.y + side * (DS_TRENCH_HALF + 240));
        this.root.add(g);
        this.targets.push(new Target(this.nextId++, g, 90, new THREE.Vector3(110, 130, 110), 18, false));
      }
    }

    // The thermal exhaust port — recessed glowing target in the trench floor.
    const port = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(120, 30, 12, 28), PORT_RING);
    ring.rotation.x = Math.PI / 2; port.add(ring);
    const wellGlow = new THREE.Mesh(new THREE.CircleGeometry(110, 28),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.4, 0.4), toneMapped: false }));
    wellGlow.rotation.x = -Math.PI / 2; wellGlow.position.y = 2; port.add(wellGlow);
    // vent slats
    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(220, 12, 18), PORT_RING);
      slat.position.set(0, 8, -75 + i * 50); port.add(slat);
    }
    port.position.copy(EXHAUST_PORT);
    this.root.add(port);
    this.targets.push(new Target(this.nextId++, port, 140, new THREE.Vector3(150, 80, 150), 60, true));
  }

  update(): void {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (t.alive) continue;
      this.effects.spawnExplosion(t.position.clone(), t.isPort ? 4.0 : 1.6);
      this.effects.spawnDebris(t.position.clone(), new THREE.Vector3(), t.isPort ? 24 : 8, t.isPort ? 2.0 : 1.0);
      this.root.remove(t.group);
      this.onKill(t.isPort ? 1000 : 150);
      if (t.isPort) this.onPortDestroyed?.();
      this.targets.splice(i, 1);
    }
  }
}
