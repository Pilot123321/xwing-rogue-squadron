/**
 * Blaster bolts (laser cannons) and proton torpedoes for the X-wing game.
 *
 * Bolts are pooled elongated quads that fly straight and expire on a timer or on
 * hitting a combatant of the opposing faction. Torpedoes are a handful of homing
 * projectiles that steer toward a locked target and detonate on proximity.
 * Collision is resolved here against a list of combatants supplied each frame.
 * Units: world "meters", seconds.
 */

import * as THREE from "three";
import type { Effects } from "./effects.ts";

export type Faction = "player" | "enemy";

export interface Combatant {
  id: number;
  faction: Faction;
  position: THREE.Vector3; // live reference (a group.position)
  radius: number; // bounding sphere (fallback / torpedo blast / lead aiming)
  alive: boolean;
  hit(dmg: number, at: THREE.Vector3, kind?: "gun" | "missile"): void;
  // Optional oriented box for precise hits (matches the visible model). When
  // present, bolt collision uses this instead of the bounding sphere.
  quaternion?: THREE.Quaternion; // live orientation reference
  halfExtents?: THREE.Vector3; // local-space half sizes
}

interface Bolt {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  faction: Faction;
  dmg: number;
}

interface Torpedo {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  target: Combatant | null;
  point: THREE.Vector3 | null; // laser-designated ground point (A2G bomb)
  trail: THREE.Points;
  trailPos: Float32Array;
  trailHead: number;
}

const BOLT_MAX = 700;
const BOLT_SPEED = 2600;
const BOLT_LEN = 26;

// Scratch vectors for the swept-collision test (avoid per-frame allocations).
const _a = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _local = new THREE.Vector3();
const _iq = new THREE.Quaternion();

/** Thickness padding for a laser bolt (it's a thin line, give it a little body). */
const BOLT_PAD = 2.6;

/** Squared distance from point p to the segment a->b. */
function distSqToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const len2 = _ab.lengthSq();
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, _ap.dot(_ab) / len2)) : 0;
  return _ap.distanceToSquared(_ab.multiplyScalar(t));
}

/** Point on segment a->b closest to p, written into out. */
function closestOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3): void {
  _ab.subVectors(b, a);
  const len2 = _ab.lengthSq();
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, _ap.subVectors(p, a).dot(_ab) / len2)) : 0;
  out.copy(a).addScaledVector(_ab, t);
}

/**
 * Does the segment a->b strike combatant c? Uses c's oriented box when it has
 * one (accurate to the model silhouette), otherwise its bounding sphere.
 */
function boltHits(c: Combatant, a: THREE.Vector3, b: THREE.Vector3): boolean {
  if (c.halfExtents && c.quaternion) {
    // Closest point on the bolt's travel to the box centre, brought into the
    // combatant's local frame, then tested against the padded half-extents.
    closestOnSegment(c.position, a, b, _cp);
    _local.copy(_cp).sub(c.position).applyQuaternion(_iq.copy(c.quaternion).invert());
    const he = c.halfExtents;
    return Math.abs(_local.x) <= he.x + BOLT_PAD
      && Math.abs(_local.y) <= he.y + BOLT_PAD
      && Math.abs(_local.z) <= he.z + BOLT_PAD;
  }
  const r = c.radius + BOLT_PAD;
  return distSqToSegment(c.position, a, b) <= r * r;
}

export class Blasters {
  private pool: THREE.Mesh[] = [];
  private bolts: (Bolt | null)[] = [];
  private head = 0;
  private torps: Torpedo[] = [];
  /** Fires when a player bolt strikes an enemy (killed=true if it destroyed it). */
  onPlayerHit: ((killed: boolean) => void) | null = null;

  constructor(private root: THREE.Object3D, private effects: Effects) {
    // HDR colours (>1) + toneMapped:false so the bloom pass makes bolts glow.
    const playerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.5, 0.25), toneMapped: false });
    const enemyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 3.2, 0.7), toneMapped: false });
    const geo = new THREE.BoxGeometry(0.5, 0.5, BOLT_LEN);
    for (let i = 0; i < BOLT_MAX; i++) {
      // material chosen at fire time by swapping; store both via userData.
      const m = new THREE.Mesh(geo, playerMat);
      m.visible = false;
      m.frustumCulled = false;
      m.userData.player = playerMat;
      m.userData.enemy = enemyMat;
      this.root.add(m);
      this.pool.push(m);
      this.bolts.push(null);
    }
  }

  fire(origin: THREE.Vector3, dir: THREE.Vector3, ownVel: THREE.Vector3, faction: Faction, dmg: number): void {
    const i = this.head;
    this.head = (this.head + 1) % BOLT_MAX;
    const d = dir.clone().normalize();
    const vel = d.clone().multiplyScalar(BOLT_SPEED).add(ownVel);
    this.bolts[i] = { pos: origin.clone(), vel, life: 2.2, faction, dmg };
    const m = this.pool[i];
    m.material = m.userData[faction];
    m.visible = true;
    m.position.copy(origin);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
  }

  launchTorpedo(origin: THREE.Vector3, dir: THREE.Vector3, ownVel: THREE.Vector3, target: Combatant | null): void {
    this.spawnGuided(origin, dir, ownVel, target, null, new THREE.Color(0.5, 1.8, 3.4), 420);
  }

  /** Air-to-ground laser-guided bomb: homes onto a designated ground point. */
  launchGuidedBomb(origin: THREE.Vector3, dir: THREE.Vector3, ownVel: THREE.Vector3, point: THREE.Vector3): void {
    this.spawnGuided(origin, dir, ownVel, null, point.clone(), new THREE.Color(2.4, 1.6, 0.4), 360);
  }

  private spawnGuided(
    origin: THREE.Vector3, dir: THREE.Vector3, ownVel: THREE.Vector3,
    target: Combatant | null, point: THREE.Vector3 | null, color: THREE.Color, launchSpeed: number,
  ): void {
    if (this.torps.length > 8) return;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 18, 12),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
    mesh.position.copy(origin);
    this.root.add(mesh);
    const N = 40;
    const tp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { tp[i * 3] = origin.x; tp[i * 3 + 1] = origin.y; tp[i * 3 + 2] = origin.z; }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(tp, 3));
    const trail = new THREE.Points(tg, new THREE.PointsMaterial({ color: 0x99eeff, size: 4, transparent: true, opacity: 0.7 }));
    trail.frustumCulled = false;
    this.root.add(trail);
    this.torps.push({
      mesh,
      vel: dir.clone().normalize().multiplyScalar(launchSpeed).add(ownVel),
      life: 8,
      target, point,
      trail, trailPos: tp, trailHead: 0,
    });
  }

  get torpedoCount(): number { return this.torps.length; }

  update(dt: number, combatants: Combatant[]): void {
    // --- Bolts ---
    for (let i = 0; i < BOLT_MAX; i++) {
      const b = this.bolts[i];
      if (!b) continue;
      b.life -= dt;
      const prev = _a.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      const m = this.pool[i];
      m.position.copy(b.pos);

      let consumed = b.life <= 0;
      if (!consumed) {
        for (const c of combatants) {
          if (!c.alive || c.faction === b.faction) continue;
          // Swept + oriented-box test: bolts move far per step, so test the whole
          // segment travelled this frame against the target's actual silhouette.
          if (boltHits(c, prev, b.pos)) {
            const wasAlive = c.alive;
            c.hit(b.dmg, b.pos.clone(), "gun");
            if (b.faction === "player" && c.faction === "enemy") {
              this.onPlayerHit?.(wasAlive && !c.alive);
            }
            consumed = true;
            break;
          }
        }
      }
      if (consumed) {
        this.bolts[i] = null;
        m.visible = false;
      }
    }

    // --- Torpedoes (homing) ---
    for (let i = this.torps.length - 1; i >= 0; i--) {
      const t = this.torps[i];
      t.life -= dt;
      // drop a dead target
      if (t.target && !t.target.alive) t.target = null;
      // Guidance: homes onto a combatant (missile) or a designated ground point
      // (laser-guided bomb) — laser-guided fighter-jet style.
      const aimPos = t.target ? t.target.position : t.point;
      if (aimPos) {
        const to = aimPos.clone().sub(t.mesh.position).normalize();
        const speed = t.vel.length();
        t.vel.lerp(to.multiplyScalar(speed), 1 - Math.exp(-dt * 3.5));
        t.vel.setLength(Math.min(900, speed + 500 * dt)); // accelerate
      }
      t.mesh.position.addScaledVector(t.vel, dt);

      // trail
      const h = t.trailHead;
      t.trailPos[h * 3] = t.mesh.position.x;
      t.trailPos[h * 3 + 1] = t.mesh.position.y;
      t.trailPos[h * 3 + 2] = t.mesh.position.z;
      t.trailHead = (t.trailHead + 1) % (t.trailPos.length / 3);
      (t.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

      let boom = t.life <= 0;
      // A2G bomb detonates on reaching its designated ground point.
      if (t.point && t.mesh.position.distanceToSquared(t.point) <= 40 * 40) boom = true;
      for (const c of combatants) {
        if (!c.alive || c.faction === "player") continue; // player ordnance only hits enemies
        if (t.mesh.position.distanceToSquared(c.position) <= (c.radius + 14) * (c.radius + 14)) {
          c.hit(120, t.mesh.position.clone(), "missile");
          boom = true;
          break;
        }
      }
      if (boom) {
        this.effects.spawnExplosion(t.mesh.position.clone(), t.point ? 3.0 : 1.6);
        this.root.remove(t.mesh);
        this.root.remove(t.trail);
        t.trail.geometry.dispose();
        (t.mesh.geometry as THREE.BufferGeometry).dispose();
        this.torps.splice(i, 1);
      }
    }
  }
}
