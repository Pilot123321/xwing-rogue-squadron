// src/web/scene.ts
import * as THREE11 from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// src/web/effects.ts
import * as THREE from "three";
var Effects = class {
  constructor(root) {
    this.root = root;
  }
  root;
  explosions = [];
  debris = [];
  puffs = [];
  /** Tumbling wreckage chunks flung from a destroyed ship (no gravity in space). */
  spawnDebris(pos, baseVel, n = 12, scale = 1) {
    for (let i = 0; i < n; i++) {
      const s = (0.6 + Math.random() * 1.6) * scale;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(s, s * (0.3 + Math.random() * 0.7), s * (0.4 + Math.random())),
        new THREE.MeshStandardMaterial({ color: 6975092, metalness: 0.6, roughness: 0.5, transparent: true, opacity: 1 })
      );
      mesh.position.copy(pos);
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      const vel = dir.multiplyScalar((25 + Math.random() * 70) * scale).addScaledVector(baseVel, 0.4);
      const spin = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
      this.root.add(mesh);
      this.debris.push({ mesh, vel, spin, t: 0, dur: 2.2 + Math.random() * 1.2 });
    }
  }
  /** A small dark smoke puff (battle damage trailing off a hull). */
  spawnSmoke(pos) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 3356218, transparent: true, opacity: 0.55 })
    );
    mesh.position.copy(pos);
    this.root.add(mesh);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8);
    this.puffs.push({ mesh, vel, t: 0, dur: 1.1 + Math.random() * 0.5 });
  }
  /** Big explosion (aircraft/missile/bomb impact). scale ~1 small, ~3 large. */
  spawnExplosion(pos, scale = 1) {
    const group = new THREE.Group();
    group.position.copy(pos);
    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(1, 28, 18),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 2.2, 0.9), transparent: true, opacity: 1, toneMapped: false })
    );
    group.add(fire);
    const n = Math.floor(40 * scale);
    const positions = new Float32Array(n * 3);
    const velocities = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      const sp = (40 + Math.random() * 120) * scale;
      velocities[i * 3] = dir.x * sp;
      velocities[i * 3 + 1] = dir.y * sp + 30 * scale;
      velocities[i * 3 + 2] = dir.z * sp;
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: 16744496, size: 4, sizeAttenuation: true, transparent: true }));
    group.add(particles);
    const light = new THREE.PointLight(16752704, 8, 4e3 * scale);
    group.add(light);
    this.root.add(group);
    this.explosions.push({ group, fire, particles, velocities, light, t: 0, dur: 1.6 });
    group.userData.scale = scale;
  }
  /** Small dust/spark puff for bullet ground hits. */
  spawnImpact(pos) {
    this.spawnExplosion(pos, 0.4);
  }
  update(dt) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.t += dt;
      const k = e.t / e.dur;
      const scale = e.group.userData.scale ?? 1;
      const r = (5 + 20 * Math.min(1, k * 2)) * scale;
      e.fire.scale.setScalar(r);
      e.fire.material.opacity = Math.max(0, 1 - k * 1.3);
      e.fire.material.color.setRGB(
        ...k < 0.3 ? [3.8, 3, 1.6] : [2.8, 0.8, 0.25]
      );
      const pos = e.particles.geometry.attributes.position;
      for (let j = 0; j < pos.count; j++) {
        e.velocities[j * 3 + 1] -= 32.17 * dt;
        pos.setX(j, pos.getX(j) + e.velocities[j * 3] * dt);
        pos.setY(j, pos.getY(j) + e.velocities[j * 3 + 1] * dt);
        pos.setZ(j, pos.getZ(j) + e.velocities[j * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      e.particles.material.opacity = Math.max(0, 1 - k);
      e.light.intensity = Math.max(0, 8 * (1 - k * 1.5));
      if (e.t >= e.dur) {
        this.root.remove(e.group);
        e.fire.geometry.dispose();
        e.particles.geometry.dispose();
        this.explosions.splice(i, 1);
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t += dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      const k = d.t / d.dur;
      if (k > 0.6) d.mesh.material.opacity = Math.max(0, 1 - (k - 0.6) / 0.4);
      if (d.t >= d.dur) {
        this.root.remove(d.mesh);
        d.mesh.geometry.dispose();
        this.debris.splice(i, 1);
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.t += dt;
      const k = p.t / p.dur;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(2 + k * 10);
      p.mesh.material.opacity = Math.max(0, 0.55 * (1 - k));
      if (p.t >= p.dur) {
        this.root.remove(p.mesh);
        p.mesh.geometry.dispose();
        this.puffs.splice(i, 1);
      }
    }
  }
};

// src/web/lasers.ts
import * as THREE2 from "three";
var BOLT_MAX = 700;
var BOLT_SPEED = 2600;
var BOLT_LEN = 26;
var _a = new THREE2.Vector3();
var _ab = new THREE2.Vector3();
var _ap = new THREE2.Vector3();
var _cp = new THREE2.Vector3();
var _local = new THREE2.Vector3();
var _iq = new THREE2.Quaternion();
var BOLT_PAD = 2.6;
function distSqToSegment(p, a, b) {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const len2 = _ab.lengthSq();
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, _ap.dot(_ab) / len2)) : 0;
  return _ap.distanceToSquared(_ab.multiplyScalar(t));
}
function closestOnSegment(p, a, b, out) {
  _ab.subVectors(b, a);
  const len2 = _ab.lengthSq();
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, _ap.subVectors(p, a).dot(_ab) / len2)) : 0;
  out.copy(a).addScaledVector(_ab, t);
}
function boltHits(c, a, b) {
  if (c.halfExtents && c.quaternion) {
    closestOnSegment(c.position, a, b, _cp);
    _local.copy(_cp).sub(c.position).applyQuaternion(_iq.copy(c.quaternion).invert());
    const he = c.halfExtents;
    return Math.abs(_local.x) <= he.x + BOLT_PAD && Math.abs(_local.y) <= he.y + BOLT_PAD && Math.abs(_local.z) <= he.z + BOLT_PAD;
  }
  const r = c.radius + BOLT_PAD;
  return distSqToSegment(c.position, a, b) <= r * r;
}
var Blasters = class {
  constructor(root, effects) {
    this.root = root;
    this.effects = effects;
    const playerMat = new THREE2.MeshBasicMaterial({ color: new THREE2.Color(3.2, 0.5, 0.25), toneMapped: false });
    const enemyMat = new THREE2.MeshBasicMaterial({ color: new THREE2.Color(0.4, 3.2, 0.7), toneMapped: false });
    const geo = new THREE2.BoxGeometry(0.5, 0.5, BOLT_LEN);
    for (let i = 0; i < BOLT_MAX; i++) {
      const m = new THREE2.Mesh(geo, playerMat);
      m.visible = false;
      m.frustumCulled = false;
      m.userData.player = playerMat;
      m.userData.enemy = enemyMat;
      this.root.add(m);
      this.pool.push(m);
      this.bolts.push(null);
    }
  }
  root;
  effects;
  pool = [];
  bolts = [];
  head = 0;
  torps = [];
  /** Fires when a player bolt strikes an enemy (killed=true if it destroyed it). */
  onPlayerHit = null;
  fire(origin, dir, ownVel, faction, dmg) {
    const i = this.head;
    this.head = (this.head + 1) % BOLT_MAX;
    const d = dir.clone().normalize();
    const vel = d.clone().multiplyScalar(BOLT_SPEED).add(ownVel);
    this.bolts[i] = { pos: origin.clone(), vel, life: 2.2, faction, dmg };
    const m = this.pool[i];
    m.material = m.userData[faction];
    m.visible = true;
    m.position.copy(origin);
    m.quaternion.setFromUnitVectors(new THREE2.Vector3(0, 0, 1), d);
  }
  launchTorpedo(origin, dir, ownVel, target) {
    this.spawnGuided(origin, dir, ownVel, target, null, new THREE2.Color(0.5, 1.8, 3.4), 420);
  }
  /** Air-to-ground laser-guided bomb: homes onto a designated ground point. */
  launchGuidedBomb(origin, dir, ownVel, point) {
    this.spawnGuided(origin, dir, ownVel, null, point.clone(), new THREE2.Color(2.4, 1.6, 0.4), 360);
  }
  spawnGuided(origin, dir, ownVel, target, point, color, launchSpeed) {
    if (this.torps.length > 8) return;
    const mesh = new THREE2.Mesh(
      new THREE2.SphereGeometry(0.9, 18, 12),
      new THREE2.MeshBasicMaterial({ color, toneMapped: false })
    );
    mesh.position.copy(origin);
    this.root.add(mesh);
    const N = 40;
    const tp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      tp[i * 3] = origin.x;
      tp[i * 3 + 1] = origin.y;
      tp[i * 3 + 2] = origin.z;
    }
    const tg = new THREE2.BufferGeometry();
    tg.setAttribute("position", new THREE2.BufferAttribute(tp, 3));
    const trail = new THREE2.Points(tg, new THREE2.PointsMaterial({ color: 10088191, size: 4, transparent: true, opacity: 0.7 }));
    trail.frustumCulled = false;
    this.root.add(trail);
    this.torps.push({
      mesh,
      vel: dir.clone().normalize().multiplyScalar(launchSpeed).add(ownVel),
      life: 8,
      target,
      point,
      trail,
      trailPos: tp,
      trailHead: 0
    });
  }
  get torpedoCount() {
    return this.torps.length;
  }
  update(dt, combatants) {
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
    for (let i = this.torps.length - 1; i >= 0; i--) {
      const t = this.torps[i];
      t.life -= dt;
      if (t.target && !t.target.alive) t.target = null;
      const aimPos = t.target ? t.target.position : t.point;
      if (aimPos) {
        const to = aimPos.clone().sub(t.mesh.position).normalize();
        const speed = t.vel.length();
        t.vel.lerp(to.multiplyScalar(speed), 1 - Math.exp(-dt * 3.5));
        t.vel.setLength(Math.min(900, speed + 500 * dt));
      }
      t.mesh.position.addScaledVector(t.vel, dt);
      const h = t.trailHead;
      t.trailPos[h * 3] = t.mesh.position.x;
      t.trailPos[h * 3 + 1] = t.mesh.position.y;
      t.trailPos[h * 3 + 2] = t.mesh.position.z;
      t.trailHead = (t.trailHead + 1) % (t.trailPos.length / 3);
      t.trail.geometry.attributes.position.needsUpdate = true;
      let boom = t.life <= 0;
      if (t.point && t.mesh.position.distanceToSquared(t.point) <= 40 * 40) boom = true;
      for (const c of combatants) {
        if (!c.alive || c.faction === "player") continue;
        if (t.mesh.position.distanceToSquared(c.position) <= (c.radius + 14) * (c.radius + 14)) {
          c.hit(120, t.mesh.position.clone(), "missile");
          boom = true;
          break;
        }
      }
      if (boom) {
        this.effects.spawnExplosion(t.mesh.position.clone(), t.point ? 3 : 1.6);
        this.root.remove(t.mesh);
        this.root.remove(t.trail);
        t.trail.geometry.dispose();
        t.mesh.geometry.dispose();
        this.torps.splice(i, 1);
      }
    }
  }
};

// src/web/enemies.ts
import * as THREE4 from "three";

// src/web/tie.ts
import * as THREE3 from "three";
var POD = new THREE3.MeshStandardMaterial({ color: 6975351, metalness: 0.5, roughness: 0.5 });
var PANEL = new THREE3.MeshStandardMaterial({ color: 2106151, metalness: 0.4, roughness: 0.6, side: THREE3.DoubleSide });
var STRUT = new THREE3.MeshStandardMaterial({ color: 3488063, metalness: 0.6, roughness: 0.4 });
var EYE = new THREE3.MeshBasicMaterial({ color: 1053720 });
function buildTIE() {
  const g = new THREE3.Group();
  const pod = new THREE3.Mesh(new THREE3.SphereGeometry(1.6, 28, 18), POD);
  g.add(pod);
  const eye = new THREE3.Mesh(new THREE3.CircleGeometry(1, 18), EYE);
  eye.position.z = -1.55;
  g.add(eye);
  const ring = new THREE3.Mesh(new THREE3.TorusGeometry(1, 0.12, 14, 32), STRUT);
  ring.position.z = -1.5;
  g.add(ring);
  for (const side of [-1, 1]) {
    const strut = new THREE3.Mesh(new THREE3.CylinderGeometry(0.22, 0.22, 2, 16), STRUT);
    strut.rotation.z = Math.PI / 2;
    strut.position.set(side * 1.8, 0, 0);
    g.add(strut);
    const panel = new THREE3.Mesh(new THREE3.CylinderGeometry(3.4, 3.4, 0.25, 6), PANEL);
    panel.rotation.z = Math.PI / 2;
    panel.rotation.x = Math.PI / 2;
    panel.position.set(side * 3.4, 0, 0);
    g.add(panel);
    const spar = new THREE3.Mesh(new THREE3.BoxGeometry(0.18, 6.4, 0.3), STRUT);
    spar.position.set(side * 3.4, 0, 0);
    g.add(spar);
    const spar2 = new THREE3.Mesh(new THREE3.BoxGeometry(0.18, 0.3, 6.4), STRUT);
    spar2.position.set(side * 3.4, 0, 0);
    g.add(spar2);
  }
  return g;
}

// src/web/enemies.ts
var FORWARD = new THREE4.Vector3(0, 0, -1);
var UP = new THREE4.Vector3(0, 1, 0);
var EB = 2600;
var _sep = new THREE4.Vector3();
var _diff = new THREE4.Vector3();
var TIE = class {
  // queued extra rounds for a burst
  constructor(id, pos) {
    this.id = id;
    this.group = buildTIE();
    this.group.position.copy(pos);
  }
  id;
  faction = "enemy";
  radius = 4;
  // bounding sphere (torpedo blast / ram / lead aiming)
  // Oriented box matched to the model: wide solar panels (x), tall (y), thin (z).
  halfExtents = new THREE4.Vector3(6.8, 3.6, 2.6);
  alive = true;
  hp = 12;
  group;
  vel = new THREE4.Vector3();
  velDir = new THREE4.Vector3(0, 0, -1);
  speed = 360;
  fireCd = 1 + Math.random() * 2;
  flankPhase = Math.random() * Math.PI * 2;
  jinkPhase = Math.random() * Math.PI * 2;
  state = "engage";
  stateUntil = 0;
  breakDir = new THREE4.Vector3();
  burst = 0;
  get position() {
    return this.group.position;
  }
  get quaternion() {
    return this.group.quaternion;
  }
  hit(dmg) {
    this.hp -= dmg;
    if (this.hp <= 0) this.alive = false;
  }
};
var EnemyManager = class {
  constructor(root, effects, onKill) {
    this.root = root;
    this.effects = effects;
    this.onKill = onKill;
  }
  root;
  effects;
  onKill;
  ties = [];
  nextId = 1e3;
  /** 0..1 difficulty, raised each wave: better aim, faster turns, more fire. */
  skill = 0;
  get combatants() {
    return this.ties;
  }
  get aliveCount() {
    return this.ties.length;
  }
  /** Remove every TIE (used on a full game restart). */
  clearAll() {
    for (const t of this.ties) this.root.remove(t.group);
    this.ties.length = 0;
  }
  /** Nearest living TIE to a point (for target lock). */
  nearest(to) {
    let best = null;
    let bd = Infinity;
    for (const t of this.ties) {
      const d = t.position.distanceToSquared(to);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }
  nearestId(to) {
    return this.nearest(to)?.id ?? null;
  }
  /** Live position/velocity of a TIE by id, for lead-aiming and the target box. */
  info(id) {
    const t = this.ties.find((x) => x.id === id && x.alive);
    return t ? { position: t.position, velocity: t.vel, radius: t.radius } : null;
  }
  spawnWave(n, around) {
    for (let i = 0; i < n; i++) {
      const dir = new THREE4.Vector3(Math.random() * 2 - 1, Math.random() * 0.6 - 0.3, Math.random() * 2 - 1).normalize();
      const pos = around.clone().addScaledVector(dir, 2600 + Math.random() * 2200);
      const t = new TIE(this.nextId++, pos);
      this.root.add(t.group);
      this.ties.push(t);
    }
  }
  update(dt, t, player, fire) {
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
      const tHit = dist / EB;
      const lead = player.position.clone().addScaledVector(player.velocity, tHit);
      const toLead = lead.clone().sub(tie.position).normalize();
      if (tie.state === "break") {
        if (t >= tie.stateUntil) tie.state = "engage";
      } else if (dist < 360) {
        tie.state = "break";
        tie.stateUntil = t + 1.3 + Math.random() * 0.7;
        tie.breakDir.copy(fwd).addScaledVector(new THREE4.Vector3().crossVectors(fwd, UP).normalize(), Math.random() < 0.5 ? -1.2 : 1.2).addScaledVector(UP, Math.random() < 0.5 ? -0.5 : 0.5).normalize();
      }
      let desired;
      if (tie.state === "break") {
        desired = tie.breakDir.clone();
      } else {
        desired = toLead.clone();
        const toTie = tie.position.clone().sub(player.position).normalize();
        const beingAimed = player.forward.dot(toTie) > 0.95 && dist < 1700;
        const side = new THREE4.Vector3().crossVectors(desired, UP).normalize();
        if (beingAimed) {
          const jf = 5 + this.skill * 3;
          desired.addScaledVector(side, Math.sin(t * jf + tie.jinkPhase) * 0.9).addScaledVector(UP, Math.cos(t * (jf * 0.8) + tie.jinkPhase) * 0.5).normalize();
        } else {
          desired.addScaledVector(side, Math.sin(t * 0.8 + tie.flankPhase) * 0.2).normalize();
        }
      }
      _sep.set(0, 0, 0);
      for (const o of this.ties) {
        if (o === tie || !o.alive) continue;
        const d2 = tie.position.distanceToSquared(o.position);
        if (d2 < 200 * 200 && d2 > 1) _sep.add(_diff.subVectors(tie.position, o.position).multiplyScalar(1 / d2));
      }
      if (_sep.lengthSq() > 0) desired.add(_sep.normalize().multiplyScalar(0.5)).normalize();
      const turn = 2.2 + this.skill * 2.2;
      const targetQ = new THREE4.Quaternion().setFromUnitVectors(FORWARD, desired);
      tie.group.quaternion.slerp(targetQ, 1 - Math.exp(-dt * turn));
      const tgtSpeed = tie.state === "break" ? 540 : dist > 1400 ? 490 : 360;
      tie.speed += (tgtSpeed - tie.speed) * (1 - Math.exp(-dt * 1.8));
      const nf = FORWARD.clone().applyQuaternion(tie.group.quaternion);
      tie.velDir.lerp(nf, 1 - Math.exp(-dt * 3)).normalize();
      tie.vel.copy(tie.velDir).multiplyScalar(tie.speed);
      tie.group.position.addScaledVector(tie.vel, dt);
      tie.fireCd -= dt;
      if (tie.state === "engage") {
        const aligned = nf.dot(toLead) > 0.992 - this.skill * 0.012;
        const range = 3200 + this.skill * 900;
        if (tie.fireCd <= 0 && dist < range && aligned) {
          const muzzle = tie.position.clone().addScaledVector(nf, 6);
          const spread = 0.022 * (1 - this.skill * 0.6);
          const aimDir = toLead.clone().add(new THREE4.Vector3(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread
          )).normalize();
          fire(muzzle, aimDir, tie.vel);
          if (tie.burst > 0) {
            tie.burst--;
            tie.fireCd = 0.12;
          } else {
            tie.burst = this.skill > 0.5 ? 1 : 0;
            tie.fireCd = 1 - this.skill * 0.45 + Math.random() * 0.6;
          }
        }
      }
    }
  }
};

// src/web/ship.ts
import * as THREE6 from "three";

// src/web/xwing.ts
import * as THREE5 from "three";
var HULL = new THREE5.MeshStandardMaterial({ color: 14145745, metalness: 0.2, roughness: 0.62 });
var HULL2 = new THREE5.MeshStandardMaterial({ color: 12830141, metalness: 0.25, roughness: 0.7 });
var PANEL2 = new THREE5.MeshStandardMaterial({ color: 13488071, metalness: 0.25, roughness: 0.65, side: THREE5.DoubleSide });
var DARK = new THREE5.MeshStandardMaterial({ color: 3356477, metalness: 0.55, roughness: 0.45 });
var GREEBLE = new THREE5.MeshStandardMaterial({ color: 5396061, metalness: 0.6, roughness: 0.5 });
var METAL = new THREE5.MeshStandardMaterial({ color: 7370109, metalness: 0.75, roughness: 0.32 });
var RED = new THREE5.MeshStandardMaterial({ color: 11679016, metalness: 0.15, roughness: 0.7 });
var GLASS = new THREE5.MeshStandardMaterial({ color: 661022, metalness: 0.65, roughness: 0.12 });
var TURBINE = new THREE5.MeshStandardMaterial({ color: 1053206, metalness: 0.7, roughness: 0.35 });
function buildExhaust() {
  const g = new THREE5.Group();
  const throat = new THREE5.Mesh(new THREE5.CylinderGeometry(0.46, 0.5, 1, 28, 1, true), TURBINE);
  throat.rotation.x = Math.PI / 2;
  throat.position.z = -0.4;
  g.add(throat);
  const face = new THREE5.Mesh(new THREE5.CircleGeometry(0.46, 32), TURBINE);
  face.position.z = -0.85;
  face.rotation.y = Math.PI;
  g.add(face);
  for (let i = 0; i < 9; i++) {
    const blade = new THREE5.Mesh(new THREE5.BoxGeometry(0.06, 0.42, 0.04), GREEBLE);
    blade.position.set(0, 0, -0.82);
    blade.rotation.z = i / 9 * Math.PI * 2;
    blade.position.x = Math.cos(blade.rotation.z) * 0.2;
    blade.position.y = Math.sin(blade.rotation.z) * 0.2;
    g.add(blade);
  }
  const hub = new THREE5.Mesh(new THREE5.ConeGeometry(0.1, 0.3, 16), METAL);
  hub.rotation.x = -Math.PI / 2;
  hub.position.z = -0.7;
  g.add(hub);
  const glow = new THREE5.Mesh(
    new THREE5.TorusGeometry(0.43, 0.09, 14, 36),
    new THREE5.MeshBasicMaterial({ color: new THREE5.Color(2.6, 0.9, 0.3), transparent: true, opacity: 0.9, toneMapped: false })
  );
  glow.position.z = 0.05;
  g.add(glow);
  const core = new THREE5.Mesh(
    new THREE5.CircleGeometry(0.34, 28),
    new THREE5.MeshBasicMaterial({ color: new THREE5.Color(2.2, 1.2, 0.6), transparent: true, opacity: 0.45, toneMapped: false })
  );
  core.position.z = -0.3;
  core.rotation.y = Math.PI;
  g.add(core);
  glow.userData.core = core;
  return { group: g, glow };
}
function buildXWing() {
  const group = new THREE5.Group();
  const body = new THREE5.Mesh(new THREE5.CylinderGeometry(0.58, 0.9, 12.5, 28), HULL);
  body.rotation.x = Math.PI / 2;
  body.scale.set(1.18, 1, 0.72);
  body.position.set(0, -0.05, 1);
  group.add(body);
  const spine = new THREE5.Mesh(new THREE5.BoxGeometry(0.66, 0.4, 9), HULL2);
  spine.position.set(0, 0.5, 1.5);
  group.add(spine);
  const keel = new THREE5.Mesh(new THREE5.BoxGeometry(0.85, 0.42, 8), HULL2);
  keel.position.set(0, -0.62, 0.5);
  group.add(keel);
  const nose = new THREE5.Mesh(new THREE5.ConeGeometry(0.58, 7.6, 28), HULL);
  nose.rotation.x = -Math.PI / 2 - 0.05;
  nose.scale.set(1.18, 1, 0.6);
  nose.position.set(0, -0.18, -8.6);
  group.add(nose);
  const noseBelly = new THREE5.Mesh(new THREE5.BoxGeometry(1, 0.18, 6.5), GREEBLE);
  noseBelly.position.set(0, -0.62, -7.6);
  noseBelly.rotation.x = 0.06;
  group.add(noseBelly);
  const tip = new THREE5.Mesh(new THREE5.CylinderGeometry(0.03, 0.1, 2.4, 16), DARK);
  tip.rotation.x = Math.PI / 2 + 0.05;
  tip.position.set(0, -0.42, -13);
  group.add(tip);
  for (const sx of [-1, 1]) {
    const stripe = new THREE5.Mesh(new THREE5.BoxGeometry(0.08, 0.42, 11), RED);
    stripe.position.set(sx * 0.78, -0.1, 0.8);
    group.add(stripe);
  }
  for (const z of [-9.6, -7.9]) {
    const band = new THREE5.Mesh(new THREE5.CylinderGeometry(0.6, 0.62, 0.5, 24), RED);
    band.rotation.x = Math.PI / 2;
    band.scale.set(1.18, 1, 0.6);
    band.position.set(0, -0.18, z);
    group.add(band);
  }
  for (const z of [-5, -3, -0.5, 2.5, 4.5]) {
    const pl = new THREE5.Mesh(new THREE5.BoxGeometry(1, 0.04, 0.5), GREEBLE);
    pl.position.set(0, 0.78, z);
    group.add(pl);
  }
  const belly = new THREE5.Mesh(new THREE5.BoxGeometry(0.55, 0.3, 7), GREEBLE);
  belly.position.set(0, -0.85, -4.5);
  group.add(belly);
  const fairing = new THREE5.Mesh(new THREE5.BoxGeometry(1.1, 0.5, 3.4), HULL);
  fairing.position.set(0, 0.5, -1.6);
  group.add(fairing);
  const windscreen = new THREE5.Mesh(new THREE5.BoxGeometry(0.95, 0.7, 0.1), GLASS);
  windscreen.position.set(0, 0.78, -3.05);
  windscreen.rotation.x = 0.6;
  group.add(windscreen);
  const canopy = new THREE5.Mesh(
    new THREE5.SphereGeometry(0.8, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    GLASS
  );
  canopy.scale.set(0.86, 0.74, 2);
  canopy.position.set(0, 0.84, -1.7);
  group.add(canopy);
  for (const sx of [-1, 1]) {
    const rail = new THREE5.Mesh(new THREE5.BoxGeometry(0.055, 0.055, 3.5), METAL);
    rail.position.set(sx * 0.4, 0.92, -1.7);
    group.add(rail);
  }
  for (const z of [-3, -1.8, -0.6]) {
    const rib = new THREE5.Mesh(new THREE5.TorusGeometry(0.5, 0.04, 12, 28, Math.PI), METAL);
    rib.rotation.y = Math.PI / 2;
    rib.position.set(0, 0.84, z);
    rib.scale.set(1.42, 1.18, 1);
    group.add(rib);
  }
  const r2body = new THREE5.Mesh(new THREE5.CylinderGeometry(0.42, 0.42, 0.6, 24), HULL2);
  r2body.position.set(0, 0.78, 0.7);
  group.add(r2body);
  const r2dome = new THREE5.Mesh(
    new THREE5.SphereGeometry(0.42, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE5.MeshStandardMaterial({ color: 15921902, metalness: 0.3, roughness: 0.4 })
  );
  r2dome.position.set(0, 1.08, 0.7);
  group.add(r2dome);
  const r2blue = new THREE5.Mesh(
    new THREE5.BoxGeometry(0.34, 0.18, 0.05),
    new THREE5.MeshStandardMaterial({ color: 2254506, emissive: 1129062, roughness: 0.4 })
  );
  r2blue.position.set(0, 1.16, 0.46);
  group.add(r2blue);
  const tail = new THREE5.Mesh(new THREE5.CylinderGeometry(0.92, 0.7, 1.8, 24), DARK);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = 7.2;
  group.add(tail);
  const pivots = [];
  const engineGlows = [];
  const cannonTips = [];
  const wings = [
    [-1.5, 0.95, 1],
    // upper-left
    [1.5, 0.95, -1],
    // upper-right
    [-1.5, -0.95, -1],
    // lower-left
    [1.5, -0.95, 1]
    // lower-right
  ];
  for (const [rootX, rootY, sign] of wings) {
    const out = Math.sign(rootX);
    const pivot = new THREE5.Group();
    pivot.position.set(rootX, rootY, 2.4);
    const wing = new THREE5.Mesh(new THREE5.BoxGeometry(6.6, 0.13, 2.7), PANEL2);
    wing.position.set(out * 3.9, 0, 0.4);
    pivot.add(wing);
    const lead = new THREE5.Mesh(new THREE5.BoxGeometry(6.6, 0.13, 0.5), GREEBLE);
    lead.position.set(out * 3.9, 0, -0.98);
    pivot.add(lead);
    const tipStripe = new THREE5.Mesh(new THREE5.BoxGeometry(1, 0.15, 2.7), RED);
    tipStripe.position.set(out * 6.4, 0, 0.4);
    pivot.add(tipStripe);
    const rootStripe = new THREE5.Mesh(new THREE5.BoxGeometry(0.7, 0.15, 2.7), RED);
    rootStripe.position.set(out * 1.6, 0, 0.4);
    pivot.add(rootStripe);
    const fairing2 = new THREE5.Mesh(new THREE5.BoxGeometry(1.9, 0.5, 3), HULL);
    fairing2.position.set(out * -0.35, 0, 1);
    pivot.add(fairing2);
    const nacelle = new THREE5.Mesh(new THREE5.CylinderGeometry(0.56, 0.6, 5, 28), METAL);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(out * 0.6, 0, 1.7);
    pivot.add(nacelle);
    const eband = new THREE5.Mesh(new THREE5.CylinderGeometry(0.58, 0.58, 0.5, 28), RED);
    eband.rotation.x = Math.PI / 2;
    eband.position.set(out * 0.6, 0, 0.3);
    pivot.add(eband);
    const lip = new THREE5.Mesh(new THREE5.CylinderGeometry(0.56, 0.5, 0.4, 28), DARK);
    lip.rotation.x = Math.PI / 2;
    lip.position.set(out * 0.6, 0, -0.85);
    pivot.add(lip);
    const intake = new THREE5.Mesh(new THREE5.ConeGeometry(0.45, 1, 28, 1, true), TURBINE);
    intake.rotation.x = -Math.PI / 2;
    intake.position.set(out * 0.6, 0, -0.7);
    pivot.add(intake);
    const ex = buildExhaust();
    ex.group.position.set(out * 0.6, 0, 4.2);
    pivot.add(ex.group);
    engineGlows.push(ex.glow);
    const barrel = new THREE5.Mesh(new THREE5.CylinderGeometry(0.13, 0.16, 9.5, 24), DARK);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(out * 6.7, 0, -2);
    pivot.add(barrel);
    for (const cz of [-4.4, 0.4]) {
      const collar = new THREE5.Mesh(new THREE5.CylinderGeometry(0.2, 0.2, 0.4, 20), METAL);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(out * 6.7, 0, cz);
      pivot.add(collar);
    }
    const emitter = new THREE5.Mesh(new THREE5.CylinderGeometry(0.07, 0.13, 1.1, 16), RED);
    emitter.rotation.x = Math.PI / 2;
    emitter.position.set(out * 6.7, 0, -6.9);
    pivot.add(emitter);
    group.add(pivot);
    pivots.push({ pivot, sign, rootX, rootY });
    cannonTips.push(new THREE5.Vector3());
  }
  const TIP_LOCAL_X = 6.7;
  const TIP_LOCAL_Z = -7.4;
  const PIVOT_Z = 2.4;
  const gear = new THREE5.Group();
  const strut = (x, z) => {
    const leg = new THREE5.Mesh(new THREE5.CylinderGeometry(0.08, 0.08, 1.7, 10), METAL);
    leg.position.set(x, -1.45, z);
    gear.add(leg);
    const wheel = new THREE5.Mesh(new THREE5.CylinderGeometry(0.26, 0.26, 0.22, 16), DARK);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, -2.3, z);
    gear.add(wheel);
  };
  strut(0, -6.5);
  strut(-1.4, 1.2);
  strut(1.4, 1.2);
  gear.visible = false;
  group.add(gear);
  const xwing = {
    group,
    cannonTips,
    setGear(down) {
      gear.visible = down;
    },
    setSFoils(open) {
      const spread = open * 0.5;
      for (let i = 0; i < pivots.length; i++) {
        const { pivot, sign, rootX, rootY } = pivots[i];
        pivot.rotation.z = sign * spread;
        const out = Math.sign(rootX);
        const v = new THREE5.Vector3(out * TIP_LOCAL_X, 0, TIP_LOCAL_Z);
        v.applyEuler(new THREE5.Euler(0, 0, sign * spread));
        v.add(new THREE5.Vector3(rootX, rootY, PIVOT_Z));
        cannonTips[i].copy(v);
      }
    },
    setThrottle(t) {
      for (const g of engineGlows) {
        const m = g.material;
        m.opacity = 0.45 + t * 0.55;
        g.scale.setScalar(0.85 + t * 0.4);
        const core = g.userData.core;
        if (core) core.material.opacity = 0.3 + t * 0.6;
      }
    }
  };
  xwing.setSFoils(1);
  return xwing;
}

// src/web/ship.ts
var FORWARD2 = new THREE6.Vector3(0, 0, -1);
var CRUISE_SPEED = 480;
var MAX_SPEED = CRUISE_SPEED;
var VTOL_SPEED = 130;
var MAIN_ACCEL = 70;
var BOOST_ACCEL = 230;
var RCS_LIN = 60;
var ANG_ACCEL = new THREE6.Vector3(2.4, 1.4, 4.8);
var MAX_RATE = new THREE6.Vector3(1.3, 0.85, 3);
var DEG = Math.PI / 180;
var ONSPEED_AOA = 8.1 * DEG;
var STALL_AOA = 22 * DEG;
var G_LIMIT = 7.5;
var CORNER_SPEED = 300;
var AIR_DRAG = 0.14;
var DRAG_REF = 420;
var G_ACCEL = 9.81;
var PlayerShip = class {
  model;
  group;
  /** Linear velocity in world space (m/s). Persists — this is real momentum. */
  vel = new THREE6.Vector3(0, 0, -200);
  /** Angular velocity in the body frame (rad/s). Persists when assist is off. */
  angVel = new THREE6.Vector3();
  flightAssist = true;
  /** True when the sublight accelerator actually engaged this frame. */
  boosting = false;
  gearDown = false;
  vtol = false;
  // vertical-thrust hover mode for landing / takeoff
  // Atmospheric telemetry (valid when in air; for the HUD AoA/G cues).
  aoaDeg = 0;
  gLoad = 1;
  stalled = false;
  inAtmo = false;
  sfoils = 1;
  sfoilsTarget = 1;
  _nose = new THREE6.Vector3();
  _q = new THREE6.Quaternion();
  _axis = new THREE6.Vector3();
  _v = new THREE6.Vector3();
  constructor() {
    this.model = buildXWing();
    this.group = new THREE6.Group();
    this.group.add(this.model.group);
  }
  /** Hide/show the exterior X-wing (used for the first-person cockpit view). */
  setExteriorVisible(v) {
    this.model.group.visible = v;
  }
  toggleSFoils() {
    this.sfoilsTarget = this.sfoilsTarget > 0.5 ? 0 : 1;
  }
  get sfoilsOpen() {
    return this.sfoilsTarget > 0.5;
  }
  toggleFlightAssist() {
    this.flightAssist = !this.flightAssist;
  }
  toggleGear() {
    this.gearDown = !this.gearDown;
    this.model.setGear(this.gearDown);
  }
  toggleVtol() {
    this.vtol = !this.vtol;
  }
  get speed() {
    return this.vel.length();
  }
  /** Reset motion after a respawn (point velocity straight ahead, kill spin). */
  resetMotion(speed) {
    this.forward(this.vel).multiplyScalar(speed);
    this.angVel.set(0, 0, 0);
  }
  /** How far the velocity vector is off the nose (0 = aligned, 1 = 90deg+). */
  get slip() {
    const s = this.vel.length();
    if (s < 1e-3) return 0;
    return 1 - Math.max(0, this.forward(this._nose).dot(this._v.copy(this.vel).divideScalar(s)));
  }
  /** Nose direction in world space. */
  forward(out = new THREE6.Vector3()) {
    return out.copy(FORWARD2).applyQuaternion(this.group.quaternion);
  }
  velocity(out = new THREE6.Vector3()) {
    return out.copy(this.vel);
  }
  /** World-space muzzle points for the four wingtip cannons. */
  muzzles() {
    return this.model.cannonTips.map((p) => p.clone().applyQuaternion(this.group.quaternion).add(this.group.position));
  }
  update(c, dt, atmo = 0) {
    const wishX = -c.pitch, wishY = -c.yaw, wishZ = -c.roll;
    const wingsFolded = this.sfoils < 0.3;
    const boost = c.boost && wingsFolded;
    this.boosting = boost;
    let agility = 0.5 + 0.5 * this.sfoils;
    const sp0 = this.vel.length();
    const noseS = this.forward(this._nose);
    let aoa = 0;
    if (sp0 > 5) aoa = Math.acos(Math.max(-1, Math.min(1, noseS.dot(this._v.copy(this.vel).divideScalar(sp0)))));
    this.aoaDeg = aoa / DEG;
    this.inAtmo = atmo > 0.02;
    this.stalled = atmo > 0.1 && aoa > STALL_AOA && sp0 < CORNER_SPEED * 1.2;
    let rateX = MAX_RATE.x, rateY = MAX_RATE.y;
    if (atmo > 0) {
      const speedF = Math.min(1, sp0 / CORNER_SPEED) * (this.stalled ? 0.25 : 1);
      const gRate = G_LIMIT * G_ACCEL / Math.max(50, sp0);
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
    this.gLoad = 1 + Math.hypot(this.angVel.x, this.angVel.y) * sp0 / G_ACCEL;
    const w = this.angVel.length();
    if (w > 1e-6) {
      this._axis.copy(this.angVel).multiplyScalar(1 / w);
      this._q.setFromAxisAngle(this._axis, w * dt);
      this.group.quaternion.multiply(this._q);
    }
    const nose = this.forward(this._nose);
    if (this.vtol) {
      const climb = (c.throttle - 0.5) * 2 * VTOL_SPEED;
      const dv = this._v.set(0, climb, 0).sub(this.vel);
      const maxDV = (MAIN_ACCEL + RCS_LIN) * dt;
      if (dv.length() > maxDV) dv.setLength(maxDV);
      this.vel.add(dv);
    } else {
      const sp = this.vel.length();
      let alignRate = 0;
      if (atmo > 0) {
        const liftAuth = Math.min(1, sp / CORNER_SPEED) * (this.stalled ? 0.12 : 1);
        alignRate = 3.2 * liftAuth;
        if (this.flightAssist) alignRate = Math.max(alignRate, 1);
      } else if (this.flightAssist) {
        alignRate = 2.6;
      }
      if (sp > 1 && alignRate > 0) {
        const dir = this._v.copy(this.vel).divideScalar(sp).lerp(nose, 1 - Math.exp(-dt * alignRate)).normalize();
        this.vel.copy(dir).multiplyScalar(sp);
      }
      const accel = boost ? BOOST_ACCEL : c.throttle * MAIN_ACCEL;
      this.vel.addScaledVector(nose, accel * dt);
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
    this.sfoils += (this.sfoilsTarget - this.sfoils) * (1 - Math.exp(-dt * 6));
    this.model.setSFoils(this.sfoils);
    this.model.setThrottle(boost ? 1 : 0.3 + c.throttle * 0.7);
  }
};

// src/web/space.ts
import * as THREE8 from "three";

// src/web/surface.ts
import * as THREE7 from "three";
var PLANET_CENTER = new THREE7.Vector2(0, 0);
var PLANET_RADIUS = 15500;
var PLANET_Y = -2600;
var DS_CENTER = new THREE7.Vector2(3e4, 0);
var DS_RADIUS = 11e3;
var DS_Y = -2600;
var DS_SPHERE_R = 13e3;
var DS_SPHERE_CENTER = new THREE7.Vector3(DS_CENTER.x, -300, DS_CENTER.y);
var DS_TRENCH_W = 750;
var DS_TRENCH_DEPTH = 1900;
var BASE_POS = new THREE7.Vector3(0, PLANET_Y, 2600);
var EXHAUST_PORT = new THREE7.Vector3(DS_CENTER.x + 7e3, DS_Y - 1440, DS_CENTER.y);
function planetFbm(x, z) {
  return Math.sin(x * 45e-5) * Math.cos(z * 52e-5) * 1 + Math.sin(x * 13e-4 + 1.3) * Math.cos(z * 11e-4 + 0.7) * 0.45 + Math.sin(x * 31e-4 + 2.1) * Math.cos(z * 27e-4 + 2.3) * 0.2;
}
var PLANET_R = 9e3;
var PLANET_CY = PLANET_Y - PLANET_R;
var ATMO_THICKNESS = 1500;
function planetHeight(x, z) {
  const d = Math.hypot(x - PLANET_CENTER.x, z - PLANET_CENTER.y);
  if (d >= PLANET_R) return PLANET_CY;
  let h = PLANET_CY + Math.sqrt(PLANET_R * PLANET_R - d * d) + planetFbm(x, z) * 90;
  const bd = Math.hypot(x - BASE_POS.x, z - BASE_POS.z);
  const apron = PLANET_CY + Math.sqrt(PLANET_R * PLANET_R - (BASE_POS.x * BASE_POS.x + BASE_POS.z * BASE_POS.z));
  if (bd < 1500) h = THREE7.MathUtils.lerp(apron, h, Math.min(1, bd / 1500));
  return h;
}
var DS_TRENCH_HALF = 420;
var DS_TRENCH_FLOOR = DS_Y - 1500;
function dsHeight(lx, lz) {
  let h = DS_Y + Math.sin(lx * 4e-3) * Math.cos(lz * 4e-3) * 90 + Math.sin(lx * 0.02) * Math.sin(lz * 0.018) * 40;
  const a = Math.abs(lz);
  if (a < DS_TRENCH_HALF) h = DS_TRENCH_FLOOR;
  else if (a < DS_TRENCH_HALF + 160) h = THREE7.MathUtils.lerp(DS_TRENCH_FLOOR, h, (a - DS_TRENCH_HALF) / 160);
  return h;
}
function heightAt(x, z) {
  if (Math.hypot(x - PLANET_CENTER.x, z - PLANET_CENTER.y) < PLANET_RADIUS) {
    return planetHeight(x, z);
  }
  const lx = x - DS_CENTER.x, lz = z - DS_CENTER.y;
  if (Math.hypot(lx, lz) < DS_RADIUS) return dsHeight(lx, lz);
  return -Infinity;
}
function buildSurface() {
  const group = new THREE7.Group();
  const pads = [];
  const obstacles = [];
  const box = (cx, cy, cz, sx, sy, sz) => obstacles.push(new THREE7.Box3().setFromCenterAndSize(
    new THREE7.Vector3(cx, cy, cz),
    new THREE7.Vector3(sx, sy, sz)
  ));
  const planetGeo = new THREE7.SphereGeometry(PLANET_R, 96, 64);
  {
    const p = planetGeo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const lo = new THREE7.Color(2899234), hi = new THREE7.Color(7300164), v = new THREE7.Vector3(), c = new THREE7.Color();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i));
      const n = planetFbm(v.x * 6 + PLANET_CENTER.x, v.z * 6 + PLANET_CENTER.y);
      v.multiplyScalar(1 + n * 0.012);
      p.setXYZ(i, v.x, v.y, v.z);
      c.copy(lo).lerp(hi, THREE7.MathUtils.clamp(0.5 + n * 0.5, 0, 1));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    planetGeo.setAttribute("color", new THREE7.BufferAttribute(col, 3));
    planetGeo.computeVertexNormals();
  }
  const planet = new THREE7.Mesh(
    planetGeo,
    new THREE7.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
  );
  planet.position.set(PLANET_CENTER.x, PLANET_CY, PLANET_CENTER.y);
  group.add(planet);
  const atmo = new THREE7.Mesh(
    new THREE7.SphereGeometry(PLANET_R + ATMO_THICKNESS, 64, 48),
    new THREE7.MeshBasicMaterial({
      color: 5939455,
      transparent: true,
      opacity: 0.06,
      side: THREE7.BackSide,
      depthWrite: false,
      blending: THREE7.AdditiveBlending
    })
  );
  atmo.position.set(PLANET_CENTER.x, PLANET_CY, PLANET_CENTER.y);
  group.add(atmo);
  const apronY = PLANET_CY + Math.sqrt(PLANET_R * PLANET_R - (BASE_POS.x * BASE_POS.x + BASE_POS.z * BASE_POS.z));
  const baseMetal = new THREE7.MeshStandardMaterial({ color: 9080985, metalness: 0.5, roughness: 0.5 });
  const baseDark = new THREE7.MeshStandardMaterial({ color: 4474958, metalness: 0.6, roughness: 0.5 });
  const padMat = new THREE7.MeshStandardMaterial({ color: 2764339, metalness: 0.4, roughness: 0.7 });
  const lightMat = new THREE7.MeshBasicMaterial({ color: new THREE7.Color(0.3, 2.4, 1), toneMapped: false });
  for (let p = 0; p < 2; p++) {
    const px = BASE_POS.x + (p === 0 ? -700 : 700);
    const pz = BASE_POS.z;
    const pad = new THREE7.Mesh(new THREE7.CylinderGeometry(420, 440, 24, 32), padMat);
    pad.position.set(px, apronY + 12, pz);
    group.add(pad);
    const ring = new THREE7.Mesh(new THREE7.TorusGeometry(380, 16, 14, 56), lightMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(px, apronY + 26, pz);
    group.add(ring);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const l = new THREE7.Mesh(new THREE7.SphereGeometry(18, 16, 12), lightMat);
      l.position.set(px + Math.cos(a) * 380, apronY + 30, pz + Math.sin(a) * 380);
      group.add(l);
    }
    pads.push(new THREE7.Vector3(px, apronY + 24, pz));
  }
  const hangar = new THREE7.Mesh(new THREE7.BoxGeometry(1200, 360, 800), baseMetal);
  hangar.position.set(BASE_POS.x, apronY + 180, BASE_POS.z - 1200);
  group.add(hangar);
  box(BASE_POS.x, apronY + 180, BASE_POS.z - 1200, 1200, 360, 800);
  const hangarDoor = new THREE7.Mesh(new THREE7.BoxGeometry(700, 280, 30), baseDark);
  hangarDoor.position.set(BASE_POS.x, apronY + 140, BASE_POS.z - 800);
  group.add(hangarDoor);
  const tower = new THREE7.Mesh(new THREE7.CylinderGeometry(90, 130, 700, 24), baseMetal);
  tower.position.set(BASE_POS.x + 1400, apronY + 350, BASE_POS.z - 400);
  group.add(tower);
  box(BASE_POS.x + 1400, apronY + 350, BASE_POS.z - 400, 260, 700, 260);
  const towerTop = new THREE7.Mesh(new THREE7.CylinderGeometry(220, 180, 160, 24), baseDark);
  towerTop.position.set(BASE_POS.x + 1400, apronY + 760, BASE_POS.z - 400);
  group.add(towerTop);
  const dome = new THREE7.Mesh(new THREE7.SphereGeometry(360, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), baseDark);
  dome.position.set(BASE_POS.x - 1600, apronY, BASE_POS.z - 200);
  group.add(dome);
  return { group, heightAt, pads, obstacles };
}

// src/web/space.ts
function buildSpace() {
  const group = new THREE8.Group();
  const STARS = 3500;
  const pos = new Float32Array(STARS * 3);
  const col = new Float32Array(STARS * 3);
  for (let i = 0; i < STARS; i++) {
    const dir = new THREE8.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    const r = 9e4 + Math.random() * 1e4;
    pos[i * 3] = dir.x * r;
    pos[i * 3 + 1] = dir.y * r;
    pos[i * 3 + 2] = dir.z * r;
    const tint = Math.random();
    const c = new THREE8.Color().setHSL(0.55 + tint * 0.1, 0.2, 0.7 + Math.random() * 0.3);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  const sg = new THREE8.BufferGeometry();
  sg.setAttribute("position", new THREE8.BufferAttribute(pos, 3));
  sg.setAttribute("color", new THREE8.BufferAttribute(col, 3));
  const stars = new THREE8.Points(sg, new THREE8.PointsMaterial({ size: 220, vertexColors: true, sizeAttenuation: true }));
  stars.frustumCulled = false;
  group.add(stars);
  const sunDir = new THREE8.Vector3(0.5, 0.8, 0.3).normalize();
  const sunPos = sunDir.multiplyScalar(78e3);
  const sun = new THREE8.Group();
  sun.add(new THREE8.Mesh(
    new THREE8.SphereGeometry(4200, 32, 24),
    new THREE8.MeshBasicMaterial({ color: new THREE8.Color(8, 7.4, 6), toneMapped: false })
  ));
  sun.add(new THREE8.Mesh(
    new THREE8.SphereGeometry(8200, 32, 24),
    new THREE8.MeshBasicMaterial({ color: 16773312, transparent: true, opacity: 0.28, blending: THREE8.AdditiveBlending, depthWrite: false })
  ));
  sun.add(new THREE8.Mesh(
    new THREE8.SphereGeometry(14e3, 32, 24),
    new THREE8.MeshBasicMaterial({ color: 16770720, transparent: true, opacity: 0.12, blending: THREE8.AdditiveBlending, depthWrite: false })
  ));
  sun.position.copy(sunPos);
  group.add(sun);
  const ds = new THREE8.Group();
  const dsR = DS_SPHERE_R;
  const sphere = new THREE8.Mesh(
    new THREE8.SphereGeometry(dsR, 96, 72),
    new THREE8.MeshStandardMaterial({ color: 9146519, roughness: 0.95, metalness: 0.1 })
  );
  ds.add(sphere);
  const panelMat = new THREE8.MeshStandardMaterial({ color: 8225418, roughness: 0.9, metalness: 0.12 });
  const craterMat = new THREE8.MeshStandardMaterial({ color: 7304315, roughness: 1, metalness: 0.08 });
  for (let i = 0; i < 260; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.acos(2 * Math.random() - 1);
    const dir = new THREE8.Vector3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
    if (Math.abs(dir.y) < 0.08) continue;
    const sz = 200 + Math.random() * 500;
    const greeb = new THREE8.Mesh(new THREE8.BoxGeometry(sz, sz * (0.5 + Math.random()), 60 + Math.random() * 80), panelMat);
    greeb.position.copy(dir).multiplyScalar(dsR - 20);
    greeb.lookAt(0, 0, 0);
    ds.add(greeb);
  }
  const dish = new THREE8.Mesh(
    new THREE8.SphereGeometry(3200, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2.3),
    craterMat
  );
  dish.position.set(-4600, dsR * 0.58, -6400);
  dish.rotation.x = Math.PI;
  ds.add(dish);
  const floorMat = new THREE8.MeshStandardMaterial({ color: 2106151, roughness: 0.85, metalness: 0.2 });
  const rimMat = new THREE8.MeshStandardMaterial({ color: 7041143, roughness: 0.9, metalness: 0.15 });
  const floor = new THREE8.Mesh(new THREE8.TorusGeometry(dsR - DS_TRENCH_DEPTH, DS_TRENCH_W, 16, 320), floorMat);
  floor.rotation.x = Math.PI / 2;
  ds.add(floor);
  const edgeLight = new THREE8.MeshBasicMaterial({ color: new THREE8.Color(0.4, 1.6, 2.2), toneMapped: false });
  for (const side of [-1, 1]) {
    const rim = new THREE8.Mesh(new THREE8.TorusGeometry(dsR - 80, 180, 14, 320), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = side * (DS_TRENCH_W + 130);
    ds.add(rim);
    const strip = new THREE8.Mesh(new THREE8.TorusGeometry(dsR - 40, 30, 8, 360), edgeLight);
    strip.rotation.x = Math.PI / 2;
    strip.position.y = side * (DS_TRENCH_W + 20);
    ds.add(strip);
  }
  for (let i = 0; i < 160; i++) {
    const a = i / 160 * Math.PI * 2;
    const rib = new THREE8.Mesh(new THREE8.BoxGeometry(120, DS_TRENCH_W * 2, 220), floorMat);
    rib.position.set(Math.cos(a) * (dsR - DS_TRENCH_DEPTH * 0.4), 0, Math.sin(a) * (dsR - DS_TRENCH_DEPTH * 0.4));
    rib.rotation.y = -a;
    ds.add(rib);
  }
  ds.position.copy(DS_SPHERE_CENTER);
  group.add(ds);
  const isd = buildStarDestroyer();
  isd.position.set(0, -1200, -9e3);
  isd.rotation.y = Math.PI;
  group.add(isd);
  return {
    group,
    update() {
    }
  };
}
function buildStarDestroyer() {
  const g = new THREE8.Group();
  const grey = new THREE8.MeshStandardMaterial({ color: 9080726, metalness: 0.3, roughness: 0.7 });
  const dark = new THREE8.MeshStandardMaterial({ color: 5593439, metalness: 0.4, roughness: 0.6 });
  const hull = new THREE8.Mesh(new THREE8.CylinderGeometry(1e-3, 1, 1, 3), grey);
  hull.scale.set(1600, 1, 4800);
  hull.rotation.x = Math.PI / 2;
  hull.rotation.z = Math.PI / 2;
  hull.scale.y = 220;
  g.add(hull);
  const tower = new THREE8.Mesh(new THREE8.BoxGeometry(360, 160, 600), dark);
  tower.position.set(0, 180, 1700);
  g.add(tower);
  for (const sx of [-90, 90]) {
    const ball = new THREE8.Mesh(new THREE8.SphereGeometry(55, 28, 18), dark);
    ball.position.set(sx, 300, 1750);
    g.add(ball);
  }
  for (let i = 0; i < 6; i++) {
    const strip = new THREE8.Mesh(new THREE8.BoxGeometry(40, 30, 3e3), dark);
    strip.position.set(-500 + i * 200, 115, 0);
    g.add(strip);
  }
  return g;
}

// src/web/cockpit.ts
import * as THREE9 from "three";
function makeLabel(text) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 48;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0c0f12";
  ctx.fillRect(0, 0, 128, 48);
  ctx.fillStyle = "#cfe3ee";
  ctx.font = "bold 20px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 24);
  return new THREE9.CanvasTexture(c);
}
var SHELL = new THREE9.MeshStandardMaterial({ color: 1711394, metalness: 0.35, roughness: 0.85 });
var FRAME = new THREE9.MeshStandardMaterial({ color: 2764340, metalness: 0.55, roughness: 0.5 });
var PANEL3 = new THREE9.MeshStandardMaterial({ color: 1316378, metalness: 0.3, roughness: 0.85 });
var TRIM = new THREE9.MeshStandardMaterial({ color: 3948614, metalness: 0.6, roughness: 0.4 });
var GLASS2 = new THREE9.MeshStandardMaterial({
  color: 2833743,
  transparent: true,
  opacity: 0.16,
  side: THREE9.BackSide,
  roughness: 0.06,
  metalness: 0,
  depthWrite: false
});
function litPanel(color) {
  return new THREE9.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.5 });
}
function buildCockpit() {
  const group = new THREE9.Group();
  const canopy = new THREE9.Mesh(new THREE9.SphereGeometry(2.7, 28, 20), GLASS2);
  canopy.position.set(0, 0.75, -0.7);
  group.add(canopy);
  const floor = new THREE9.Mesh(new THREE9.BoxGeometry(2.8, 0.14, 4.4), SHELL);
  floor.position.set(0, -0.52, -0.5);
  group.add(floor);
  for (const sx of [-1, 1]) {
    const wall = new THREE9.Mesh(new THREE9.BoxGeometry(0.4, 1.5, 4.4), SHELL);
    wall.position.set(sx * 1.3, 0.05, -0.5);
    wall.rotation.z = sx * 0.16;
    group.add(wall);
    const top = new THREE9.Mesh(new THREE9.BoxGeometry(0.5, 0.1, 3), FRAME);
    top.position.set(sx * 1.26, 0.42, -0.9);
    top.rotation.z = sx * 0.16;
    group.add(top);
  }
  const frontWall = new THREE9.Mesh(new THREE9.BoxGeometry(2.8, 1, 0.2), SHELL);
  frontWall.position.set(0, -0.25, -2.45);
  group.add(frontWall);
  const rear = new THREE9.Mesh(new THREE9.BoxGeometry(2.8, 1.9, 0.25), SHELL);
  rear.position.set(0, 0.4, 1.6);
  group.add(rear);
  const roofRear = new THREE9.Mesh(new THREE9.BoxGeometry(1.4, 0.2, 1.2), SHELL);
  roofRear.position.set(0, 1.4, 1.2);
  group.add(roofRear);
  const seatBase = new THREE9.Mesh(new THREE9.BoxGeometry(0.72, 0.16, 0.7), TRIM);
  seatBase.position.set(0, -0.36, 0.35);
  group.add(seatBase);
  const seatBack = new THREE9.Mesh(new THREE9.BoxGeometry(0.72, 1.1, 0.18), TRIM);
  seatBack.position.set(0, 0.22, 0.7);
  group.add(seatBack);
  const headrest = new THREE9.Mesh(new THREE9.BoxGeometry(0.5, 0.34, 0.18), FRAME);
  headrest.position.set(0, 0.85, 0.72);
  group.add(headrest);
  const sill = new THREE9.Mesh(new THREE9.TorusGeometry(1.32, 0.05, 10, 44), FRAME);
  sill.position.set(0, -0.08, -0.6);
  sill.rotation.x = Math.PI / 2;
  sill.scale.set(1, 1.7, 1);
  group.add(sill);
  const panel = new THREE9.Mesh(new THREE9.BoxGeometry(2.7, 1.3, 0.14), PANEL3);
  panel.position.set(0, -0.05, -2.36);
  panel.rotation.x = -0.5;
  group.add(panel);
  const scopeCanvas = document.createElement("canvas");
  scopeCanvas.width = scopeCanvas.height = 256;
  const scopeTex = new THREE9.CanvasTexture(scopeCanvas);
  const scope = new THREE9.Mesh(
    new THREE9.PlaneGeometry(0.56, 0.56),
    new THREE9.MeshBasicMaterial({ map: scopeTex })
  );
  scope.position.set(0, 0.4, -2.28);
  scope.rotation.x = -0.5;
  group.add(scope);
  const bezel = new THREE9.Mesh(new THREE9.TorusGeometry(0.31, 0.04, 14, 32), TRIM);
  bezel.position.copy(scope.position);
  bezel.rotation.x = -0.5;
  group.add(bezel);
  let tvScreen;
  for (const sx of [-1, 1]) {
    const frame2 = new THREE9.Mesh(new THREE9.BoxGeometry(0.46, 0.56, 0.04), FRAME);
    frame2.position.set(sx * 0.78, 0.42, -2.3);
    frame2.rotation.x = -0.5;
    group.add(frame2);
    const mfd = new THREE9.Mesh(
      new THREE9.PlaneGeometry(0.4, 0.48),
      new THREE9.MeshBasicMaterial({ color: sx < 0 ? 329735 : 469050 })
    );
    mfd.position.set(sx * 0.78, 0.42, -2.27);
    mfd.rotation.x = -0.5;
    group.add(mfd);
    if (sx < 0) {
      tvScreen = mfd;
    } else {
      for (let r = 0; r < 4; r++) {
        const row = new THREE9.Mesh(new THREE9.PlaneGeometry(0.3, 0.04), litPanel(4643071));
        row.position.set(sx * 0.78, 0.56 - r * 0.1, -2.26);
        row.rotation.x = -0.5;
        group.add(row);
      }
    }
    const lbl = new THREE9.Mesh(
      new THREE9.PlaneGeometry(0.28, 0.055),
      new THREE9.MeshBasicMaterial({ map: makeLabel(sx < 0 ? "A/G TV" : "SYS") })
    );
    lbl.position.set(sx * 0.78, 0.17, -2.25);
    lbl.rotation.x = -0.5;
    group.add(lbl);
  }
  const barBG = new THREE9.MeshBasicMaterial({ color: 658704 });
  const mkBar = (x, color) => {
    const bg = new THREE9.Mesh(new THREE9.PlaneGeometry(0.1, 0.26), barBG);
    bg.position.set(x, -0.12, -2.22);
    bg.rotation.x = -0.5;
    group.add(bg);
    const fill = new THREE9.Mesh(new THREE9.PlaneGeometry(0.08, 0.24), new THREE9.MeshBasicMaterial({ color }));
    fill.position.set(x, -0.12, -2.21);
    fill.rotation.x = -0.5;
    group.add(fill);
    return fill;
  };
  const hullBar = mkBar(-0.98, 6160250);
  const thrBar = mkBar(-0.84, 16758311);
  const stick = new THREE9.Mesh(new THREE9.CylinderGeometry(0.04, 0.055, 0.6, 20), TRIM);
  stick.position.set(0, -0.1, -1.45);
  group.add(stick);
  const grip = new THREE9.Mesh(new THREE9.SphereGeometry(0.11, 20, 16), FRAME);
  grip.position.set(0, 0.2, -1.47);
  group.add(grip);
  for (const sx of [-1, 1]) {
    const pedal = new THREE9.Mesh(new THREE9.BoxGeometry(0.22, 0.06, 0.3), FRAME);
    pedal.position.set(sx * 0.28, -0.5, -2);
    pedal.rotation.x = -0.9;
    group.add(pedal);
  }
  const buttons = [];
  const lights = /* @__PURE__ */ new Map();
  const bodies = /* @__PURE__ */ new Map();
  const pressUntil = /* @__PURE__ */ new Map();
  const mkButton = (id, label, col, row) => {
    const bg = new THREE9.Group();
    const body = new THREE9.Mesh(
      new THREE9.BoxGeometry(0.26, 0.2, 0.08),
      new THREE9.MeshStandardMaterial({ color: 2895926, roughness: 0.55, metalness: 0.4 })
    );
    body.userData.cockpitButton = id;
    bg.add(body);
    const lab = new THREE9.Mesh(
      new THREE9.PlaneGeometry(0.24, 0.12),
      new THREE9.MeshBasicMaterial({ map: makeLabel(label) })
    );
    lab.position.z = 0.045;
    bg.add(lab);
    const light = new THREE9.Mesh(
      new THREE9.PlaneGeometry(0.2, 0.025),
      new THREE9.MeshBasicMaterial({ color: 2245666 })
    );
    light.position.set(0, -0.07, 0.046);
    bg.add(light);
    bg.position.set(-0.36 + col * 0.36, -0.16 - row * 0.26, -2.06 + row * 0.12);
    bg.rotation.x = -0.5;
    group.add(bg);
    buttons.push({ id, mesh: body });
    lights.set(id, light);
    bodies.set(id, body);
  };
  const BANK = [
    ["SFOIL", "S-FOIL"],
    ["ASSIST", "ASSIST"],
    ["TARGET", "TARGET"],
    ["AUTO", "AUTO"],
    ["BOMB", "BOMB"],
    ["VIEW", "VIEW"]
  ];
  BANK.forEach(([id, label], i) => mkButton(id, label, i % 3, Math.floor(i / 3)));
  const fireRing = new THREE9.Mesh(
    new THREE9.TorusGeometry(0.07, 0.018, 12, 28),
    new THREE9.MeshStandardMaterial({ color: 2237480, metalness: 0.6, roughness: 0.4 })
  );
  fireRing.position.set(0, 0.31, -1.47);
  fireRing.rotation.x = Math.PI / 2 - 0.3;
  group.add(fireRing);
  const fireBtn = new THREE9.Mesh(
    new THREE9.CylinderGeometry(0.06, 0.06, 0.035, 28),
    new THREE9.MeshStandardMaterial({ color: 16722463, emissive: 16718352, emissiveIntensity: 0.7, roughness: 0.4, toneMapped: false })
  );
  fireBtn.position.set(0, 0.315, -1.47);
  fireBtn.rotation.x = -0.3;
  fireBtn.userData.cockpitButton = "FIRE";
  group.add(fireBtn);
  buttons.push({ id: "FIRE", mesh: fireBtn });
  const vtolDial = new THREE9.Group();
  const dialFace = new THREE9.Mesh(
    new THREE9.CircleGeometry(0.14, 36),
    new THREE9.MeshStandardMaterial({ color: 658704, metalness: 0.3, roughness: 0.6 })
  );
  dialFace.userData.cockpitButton = "VTOL";
  vtolDial.add(dialFace);
  const dialBezel = new THREE9.Mesh(new THREE9.TorusGeometry(0.14, 0.016, 12, 36), TRIM);
  vtolDial.add(dialBezel);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const tick = new THREE9.Mesh(
      new THREE9.BoxGeometry(8e-3, i % 3 === 0 ? 0.03 : 0.018, 6e-3),
      new THREE9.MeshBasicMaterial({ color: 9085098 })
    );
    tick.position.set(Math.sin(a) * 0.115, Math.cos(a) * 0.115, 0.01);
    tick.rotation.z = -a;
    vtolDial.add(tick);
  }
  const offL = new THREE9.Mesh(new THREE9.PlaneGeometry(0.14, 0.05), new THREE9.MeshBasicMaterial({ map: makeLabel("OFF") }));
  offL.position.set(-0.16, -0.12, 0.01);
  vtolDial.add(offL);
  const onL = new THREE9.Mesh(new THREE9.PlaneGeometry(0.12, 0.05), new THREE9.MeshBasicMaterial({ map: makeLabel("ON") }));
  onL.position.set(0.16, -0.12, 0.01);
  vtolDial.add(onL);
  const vtolLabel = new THREE9.Mesh(new THREE9.PlaneGeometry(0.22, 0.06), new THREE9.MeshBasicMaterial({ map: makeLabel("VTOL") }));
  vtolLabel.position.set(0, 0.2, 0.01);
  vtolDial.add(vtolLabel);
  const vtolPtr = new THREE9.Group();
  const needle = new THREE9.Mesh(new THREE9.BoxGeometry(0.022, 0.11, 0.014), litPanel(5635976));
  needle.position.y = 0.055;
  vtolPtr.add(needle);
  const hub = new THREE9.Mesh(new THREE9.CylinderGeometry(0.03, 0.03, 0.04, 16), TRIM);
  hub.rotation.x = Math.PI / 2;
  vtolPtr.add(hub);
  vtolPtr.position.z = 0.02;
  vtolPtr.rotation.z = 1;
  vtolDial.add(vtolPtr);
  vtolDial.position.set(0.92, -0.14, -2.18);
  vtolDial.rotation.x = -0.5;
  group.add(vtolDial);
  buttons.push({ id: "VTOL", mesh: dialFace });
  const leverBase = new THREE9.Mesh(new THREE9.BoxGeometry(0.18, 0.1, 0.34), FRAME);
  leverBase.position.set(1.28, 0.42, -0.5);
  leverBase.rotation.z = 0.16;
  group.add(leverBase);
  const gearHandle = new THREE9.Group();
  const shaft = new THREE9.Mesh(new THREE9.CylinderGeometry(0.03, 0.03, 0.36, 12), TRIM);
  shaft.position.y = 0.18;
  gearHandle.add(shaft);
  const gearKnob = new THREE9.Mesh(
    new THREE9.SphereGeometry(0.07, 16, 12),
    new THREE9.MeshStandardMaterial({ color: 5635976, emissive: 1131554, roughness: 0.4 })
  );
  gearKnob.position.y = 0.38;
  gearKnob.userData.cockpitButton = "GEAR";
  gearHandle.add(gearKnob);
  gearHandle.position.set(1.28, 0.44, -0.5);
  gearHandle.rotation.x = -0.5;
  group.add(gearHandle);
  buttons.push({ id: "GEAR", mesh: gearKnob });
  group.visible = false;
  return {
    group,
    scopeCanvas,
    scopeTex,
    buttons,
    tvScreen,
    setGearLever(down) {
      gearHandle.rotation.x = down ? 0.5 : -0.5;
    },
    setVtolDial(on) {
      vtolPtr.rotation.z = on ? -1 : 1;
    },
    setIndicator(id, on) {
      const light = lights.get(id);
      if (!light) return;
      light.material.color.setHex(on ? 6750122 : 2245666);
    },
    press(id) {
      pressUntil.set(id, performance.now() + 130);
    },
    setHover(id) {
      for (const [bid, body] of bodies) {
        body.material.emissive.setHex(bid === id ? 4864512 : 0);
      }
    },
    update(now) {
      for (const [id, body] of bodies) {
        const pressed = now < (pressUntil.get(id) ?? 0);
        body.position.z += ((pressed ? -0.05 : 0) - body.position.z) * 0.4;
      }
    },
    setBars(hull, throttle) {
      const set = (m, frac) => {
        const f = Math.max(1e-3, Math.min(1, frac));
        m.scale.y = f;
        m.position.y = -0.12 - 0.12 + 0.12 * f;
      };
      set(hullBar, hull / 100);
      set(thrBar, throttle);
    }
  };
}

// src/web/radar.ts
function drawRadar(ctx, cx, cy, R, blips, time) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(2, 14, 10, 0.72)";
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = "rgba(60, 200, 120, 0.35)";
  ctx.lineWidth = 1;
  for (const f of [0.33, 0.66, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R);
  ctx.lineTo(cx, cy + R);
  ctx.stroke();
  const a = time * 1.6 % (Math.PI * 2);
  const grad = ctx.createLinearGradient(cx, cy, cx + Math.sin(a) * R, cy - Math.cos(a) * R);
  grad.addColorStop(0, "rgba(80, 255, 150, 0.55)");
  grad.addColorStop(1, "rgba(80, 255, 150, 0)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
  ctx.stroke();
  for (const b of blips) {
    const x = cx + b.rx * R;
    const y = cy + b.ry * R;
    const locked = b.locked;
    ctx.fillStyle = locked ? "#ff4533" : "#ffd24a";
    const s = locked ? 4.5 : 3.2;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
    if (locked) {
      ctx.strokeStyle = "#ff4533";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 6, y - 6, 12, 12);
    }
    if (Math.abs(b.elev) > 120) {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1;
      const dir = b.elev > 0 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + dir * 6);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = "#3cc878";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#9effc4";
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx - 4, cy + 5);
  ctx.lineTo(cx + 4, cy + 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// src/web/ground.ts
import * as THREE10 from "three";
var UP2 = new THREE10.Vector3(0, 1, 0);
var TURRET = new THREE10.MeshStandardMaterial({ color: 6975351, metalness: 0.6, roughness: 0.45 });
var BARREL = new THREE10.MeshStandardMaterial({ color: 3816770, metalness: 0.6, roughness: 0.4 });
var PORT_RING = new THREE10.MeshStandardMaterial({ color: 5593439, metalness: 0.7, roughness: 0.4 });
var Target = class {
  // rotating turret head (aims at player)
  constructor(id, group, radius, halfExtents, hp, isPort) {
    this.id = id;
    this.group = group;
    this.radius = radius;
    this.halfExtents = halfExtents;
    this.hp = hp;
    this.isPort = isPort;
  }
  id;
  group;
  radius;
  halfExtents;
  hp;
  isPort;
  faction = "enemy";
  quaternion = new THREE10.Quaternion();
  // static (identity)
  alive = true;
  fireCd = 1 + Math.random() * 2;
  head = null;
  get position() {
    return this.group.position;
  }
  hit(dmg) {
    this.hp -= dmg;
    if (this.hp <= 0) this.alive = false;
  }
};
var TURRET_RANGE = 4200;
var TURRET_BOLT = 2400;
var _v0 = new THREE10.Vector3();
var _v1 = new THREE10.Vector3();
var GroundTargets = class {
  constructor(root, effects, onKill) {
    this.root = root;
    this.effects = effects;
    this.onKill = onKill;
    this.build();
  }
  root;
  effects;
  onKill;
  targets = [];
  nextId = 5e3;
  /** Fires when the exhaust port is destroyed (mission complete). */
  onPortDestroyed = null;
  get combatants() {
    return this.targets;
  }
  /** A point on the equatorial trench floor at angle a, oriented radially out. */
  grooveSpot(a, depthFactor = 0.55) {
    const r = DS_SPHERE_R - DS_TRENCH_DEPTH * depthFactor;
    const radial = new THREE10.Vector3(Math.cos(a), 0, Math.sin(a));
    const pos = DS_SPHERE_CENTER.clone().addScaledVector(radial, r);
    const q = new THREE10.Quaternion().setFromUnitVectors(UP2, radial);
    return { pos, q };
  }
  build() {
    const N = 26;
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2;
      if (Math.abs(a) < 0.14) continue;
      const radial = new THREE10.Vector3(Math.cos(a), 0, Math.sin(a));
      const q = new THREE10.Quaternion().setFromUnitVectors(UP2, radial);
      for (const side of [-1, 1]) {
        const g = new THREE10.Group();
        const base = new THREE10.Mesh(new THREE10.CylinderGeometry(120, 150, 220, 18), TURRET);
        base.position.y = 110;
        g.add(base);
        const head = new THREE10.Mesh(new THREE10.SphereGeometry(130, 18, 14), TURRET);
        head.position.y = 250;
        g.add(head);
        const barrels = new THREE10.Group();
        for (const bx of [-45, 45]) {
          const barrel = new THREE10.Mesh(new THREE10.CylinderGeometry(20, 20, 300, 12), BARREL);
          barrel.rotation.x = Math.PI / 2;
          barrel.position.set(bx, 0, -150);
          barrels.add(barrel);
        }
        barrels.position.y = 250;
        g.add(barrels);
        g.position.copy(DS_SPHERE_CENTER).addScaledVector(radial, DS_SPHERE_R - 60);
        g.position.y += side * (DS_TRENCH_W + 60);
        g.quaternion.copy(q);
        this.root.add(g);
        const tgt = new Target(this.nextId++, g, 150, new THREE10.Vector3(170, 260, 170), 24, false);
        tgt.head = barrels;
        this.targets.push(tgt);
      }
    }
    const port = new THREE10.Group();
    const ring = new THREE10.Mesh(new THREE10.TorusGeometry(150, 38, 12, 28), PORT_RING);
    ring.rotation.x = Math.PI / 2;
    port.add(ring);
    const wellGlow = new THREE10.Mesh(
      new THREE10.CircleGeometry(140, 28),
      new THREE10.MeshBasicMaterial({ color: new THREE10.Color(2.6, 1.5, 0.4), toneMapped: false })
    );
    wellGlow.rotation.x = -Math.PI / 2;
    wellGlow.position.y = 4;
    port.add(wellGlow);
    for (let i = 0; i < 4; i++) {
      const slat = new THREE10.Mesh(new THREE10.BoxGeometry(280, 14, 22), PORT_RING);
      slat.position.set(0, 10, -95 + i * 64);
      port.add(slat);
    }
    const ps = this.grooveSpot(0, 0.95);
    port.position.copy(ps.pos);
    port.quaternion.copy(ps.q);
    this.root.add(port);
    this.targets.push(new Target(this.nextId++, port, 180, new THREE10.Vector3(190, 100, 190), 60, true));
  }
  update(dt, player, fire) {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (!t.alive) {
        this.effects.spawnExplosion(t.position.clone(), t.isPort ? 4 : 1.6);
        this.effects.spawnDebris(t.position.clone(), new THREE10.Vector3(), t.isPort ? 24 : 8, t.isPort ? 2 : 1);
        this.root.remove(t.group);
        this.onKill(t.isPort ? 1e3 : 150);
        if (t.isPort) this.onPortDestroyed?.();
        this.targets.splice(i, 1);
        continue;
      }
      if (t.isPort) continue;
      const dist = t.position.distanceTo(player.position);
      if (dist > TURRET_RANGE) continue;
      const tHit = dist / TURRET_BOLT;
      const aim = _v0.copy(player.position).addScaledVector(player.velocity, tHit);
      if (t.head) t.head.lookAt(aim);
      t.fireCd -= dt;
      if (t.fireCd <= 0) {
        const dir = _v1.copy(aim).sub(t.position).normalize();
        const muzzle = t.position.clone().addScaledVector(dir, 280).setY(t.position.y + 250);
        fire(muzzle, dir);
        t.fireCd = 1.4 + Math.random() * 1.4;
      }
    }
  }
};

// src/web/scene.ts
var FORWARD3 = new THREE11.Vector3(0, 0, -1);
var BOLT_SPEED2 = 2600;
var GUN_RMAX = 3e3;
var G_SURF = 26;
var PLANET_CENTER3 = new THREE11.Vector3(PLANET_CENTER.x, PLANET_CY, PLANET_CENTER.y);
var Scene3D = class {
  scene = new THREE11.Scene();
  camera;
  renderer;
  view = "chase";
  // event hooks (wired to audio by the host)
  onPlayerFire = null;
  onEnemyFire = null;
  onExplosion = null;
  onPlayerHit = null;
  onTorpedo = null;
  onLock = null;
  onCockpitClick = null;
  /** Broadcast our laser fire to other players (online). */
  onFire = null;
  effects;
  blasters;
  enemies;
  player;
  space;
  // player combat state
  hull = 100;
  shields = 100;
  lives = 3;
  dead = false;
  respawnAt = 0;
  timeSinceHit = 0;
  // game progression
  score = 0;
  wave = 0;
  nextWaveAt = 0;
  message = "";
  messageUntil = 0;
  // weapons
  laserHeat = 0;
  overheated = false;
  lastFire = 0;
  cannonIdx = 0;
  torps = 8;
  // targeting + radar lock
  lockedId = null;
  lockProgress = 0;
  // 0..1 building toward a hard lock
  hardLock = false;
  autoLock = true;
  // auto-acquire nearest TIE; toggle off for manual targeting
  aimAssistActive = false;
  // true when the boresight reticle is inside the lock circle
  prevHardLock = false;
  raycaster = new THREE11.Raycaster();
  // surface battlefields (planet / Death Star)
  surfaceHeightAt;
  pads = [];
  obstacles = [];
  // Solid celestial bodies you crash into if you penetrate their surface.
  crashSpheres = [];
  prevPos = new THREE11.Vector3();
  _dsRel = new THREE11.Vector3();
  groundTargets;
  // Player collision: half-extents of the X-wing hull (wingspan x, thin y/z).
  playerHalf = new THREE11.Vector3(7, 3, 11);
  // Crash camera shake.
  shakeUntil = 0;
  shakeMag = 0;
  // Right-side kill feed (DCS-style stacked entries).
  feed = [];
  lastDamageFeed = 0;
  landed = false;
  agl = null;
  // battle damage / destruction
  gunHits = 0;
  // gun hits that have reached the hull
  damageFire = null;
  smokeTimer = 0;
  // sublight accelerator visual ramp (0..1)
  boostVis = 0;
  baseFov = 65;
  lastThrottle = 0;
  // Drag-to-look camera offsets (radians). Yaw is unbounded (full 360°).
  lookYaw = 0;
  lookPitch = 0;
  clock = new THREE11.Clock();
  tmp = new THREE11.Vector3();
  tmp2 = new THREE11.Vector3();
  _q = new THREE11.Quaternion();
  hud;
  // cockpit interior + radar
  cockpit;
  scopeCtx;
  blips = [];
  RADAR_RANGE = 6500;
  // player combatant wrapper so enemy bolts can hit us
  playerCombatant;
  // post-processing
  composer;
  // air-to-ground targeting pod (TV feed -> cockpit MFD) + laser designation
  podCam;
  tvTarget;
  groundTarget = null;
  // online multiplayer: other players' ships (interpolated from snapshots)
  remotes = /* @__PURE__ */ new Map();
  constructor(canvas) {
    this.renderer = new THREE11.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE11.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.scene.background = new THREE11.Color(66314);
    this.camera = new THREE11.PerspectiveCamera(65, 1, 0.5, 25e4);
    this.podCam = new THREE11.PerspectiveCamera(15, 1, 1, 4e4);
    this.tvTarget = new THREE11.WebGLRenderTarget(256, 256);
    const pmrem = new THREE11.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const sunDir = new THREE11.Vector3(0.5, 0.8, 0.3).normalize();
    const sun = new THREE11.DirectionalLight(16774368, 2.7);
    sun.position.copy(sunDir);
    this.scene.add(sun);
    this.scene.add(new THREE11.HemisphereLight(4213350, 526352, 0.7));
    this.scene.add(new THREE11.AmbientLight(2240580, 0.6));
    this.space = buildSpace();
    this.scene.add(this.space.group);
    const surf = buildSurface();
    this.scene.add(surf.group);
    this.surfaceHeightAt = surf.heightAt;
    this.pads = surf.pads;
    this.obstacles = surf.obstacles;
    this.crashSpheres = [
      { c: new THREE11.Vector3(PLANET_CENTER.x, PLANET_CY, PLANET_CENTER.y), r: PLANET_R }
    ];
    this.effects = new Effects(this.scene);
    this.blasters = new Blasters(this.scene, this.effects);
    this.enemies = new EnemyManager(this.scene, this.effects, () => {
      this.score += 100;
      this.onExplosion?.();
    });
    this.blasters.onPlayerHit = (killed) => {
      if (killed) this.pushFeed("TIE FIGHTER DESTROYED", "#ff4533");
      else {
        const now = this.clock.getElapsedTime();
        if (now - this.lastDamageFeed > 0.5) {
          this.lastDamageFeed = now;
          this.pushFeed("TIE FIGHTER DAMAGED", "#e8eef2");
        }
      }
    };
    this.groundTargets = new GroundTargets(this.scene, this.effects, (pts) => {
      this.score += pts;
      this.onExplosion?.();
      this.pushFeed(pts >= 1e3 ? "EXHAUST PORT DESTROYED" : "TURBOLASER DESTROYED", "#ff4533");
    });
    this.groundTargets.onPortDestroyed = () => this.flash("EXHAUST PORT DESTROYED \u2014 GREAT SHOT, KID!", 5);
    this.player = new PlayerShip();
    this.scene.add(this.player.group);
    this.cockpit = buildCockpit();
    this.scopeCtx = this.cockpit.scopeCanvas.getContext("2d");
    this.player.group.add(this.cockpit.group);
    this.cockpit.tvScreen.material.map = this.tvTarget.texture;
    this.cockpit.tvScreen.material.color.set(16777215);
    this.playerCombatant = {
      id: 1,
      faction: "player",
      position: this.player.group.position,
      radius: 7,
      get alive() {
        return true;
      },
      hit: (dmg, _at, kind) => this.damagePlayer(dmg, kind ?? "gun")
    };
    this.hud = this.buildHud();
    this.startWave();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE11.Vector2(window.innerWidth, window.innerHeight),
      0.9,
      // strength
      0.5,
      // radius
      0.55
      // luminance threshold (only HDR energy elements bloom)
    );
    this.composer.addPass(bloom);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }
  buildHud() {
    return {
      speed: 0,
      throttle: 0,
      maxSpeed: MAX_SPEED,
      hull: 100,
      shields: 100,
      score: 0,
      wave: 1,
      lives: 3,
      enemiesLeft: 0,
      sfoils: true,
      torps: 8,
      laserHeat: 0,
      boost: 0,
      view: this.view,
      flightAssist: true,
      blips: [],
      radarRange: this.RADAR_RANGE
    };
  }
  // ---- progression ----
  startWave() {
    this.wave++;
    const n = 6 + this.wave * 3;
    this.enemies.skill = Math.min(1, this.wave * 0.16);
    this.enemies.spawnWave(n, this.player.group.position);
    this.flash(`WAVE ${this.wave} \u2014 ${n} TIE FIGHTERS INBOUND`, 2.5);
  }
  flash(msg, secs) {
    this.message = msg;
    this.messageUntil = this.clock.getElapsedTime() + secs;
  }
  // ---- player damage / respawn ----
  damagePlayer(dmg, kind = "gun") {
    if (this.dead) return;
    this.timeSinceHit = 0;
    this.onPlayerHit?.();
    if (kind === "missile") {
      this.hull = 0;
      this.killPlayer();
      return;
    }
    const hullBefore = this.hull;
    this.hull -= dmg;
    if (this.hull < hullBefore) {
      this.gunHits++;
      if (this.gunHits >= 3) this.ensureDamageFire();
    }
    if (this.hull <= 0) {
      this.hull = 0;
      this.killPlayer();
    }
  }
  /** Attach a flickering fire + smoke to the X-wing when it's badly shot up. */
  ensureDamageFire() {
    if (this.damageFire) return;
    const g = new THREE11.Group();
    const flame = new THREE11.Mesh(
      new THREE11.ConeGeometry(0.9, 2.6, 8),
      new THREE11.MeshBasicMaterial({ color: new THREE11.Color(3.2, 1.2, 0.3), transparent: true, opacity: 0.9, toneMapped: false })
    );
    flame.position.set(1.3, 0.5, 2.2);
    g.add(flame);
    g.userData.flame = flame;
    this.player.group.add(g);
    this.damageFire = g;
  }
  removeDamageFire() {
    if (this.damageFire) {
      this.player.group.remove(this.damageFire);
      this.damageFire = null;
    }
    this.gunHits = 0;
  }
  killPlayer() {
    this.dead = true;
    this.lives--;
    this.removeDamageFire();
    const p = this.player.group.position.clone();
    const v = this.player.vel.clone();
    this.effects.spawnExplosion(p, 3);
    this.effects.spawnDebris(p, v, 22, 1.8);
    for (let i = 1; i <= 4; i++) {
      const t = i * 0.18;
      const off = p.clone().addScaledVector(v.clone().normalize(), i * 18).add(new THREE11.Vector3((Math.random() - 0.5) * 36, (Math.random() - 0.5) * 36, (Math.random() - 0.5) * 36));
      setTimeout(() => this.effects.spawnExplosion(off, 1.2 + Math.random()), t * 1e3);
    }
    this.shakeUntil = this.clock.getElapsedTime() + 0.9;
    this.shakeMag = 6;
    this.onExplosion?.();
    this.player.group.visible = false;
    this.view = "chase";
    if (this.lives <= 0) {
      this.flash(`GAME OVER \u2014 SCORE ${this.score}`, 4);
      this.respawnAt = this.clock.getElapsedTime() + 4;
    } else {
      this.flash(`HIT! ${this.lives} X-WING${this.lives === 1 ? "" : "S"} LEFT`, 2.5);
      this.respawnAt = this.clock.getElapsedTime() + 2.8;
    }
  }
  respawn(fullRestart) {
    if (fullRestart) {
      this.score = 0;
      this.wave = 0;
      this.lives = 3;
      this.enemies.clearAll();
      this.lockedId = null;
      this.lockProgress = 0;
      this.hardLock = false;
      this.startWave();
    }
    this.player.group.position.set(0, 0, 0);
    this.player.group.quaternion.identity();
    this.player.resetMotion(320);
    this.hull = 100;
    this.laserHeat = 0;
    this.overheated = false;
    this.removeDamageFire();
    this.player.group.visible = true;
    this.dead = false;
  }
  // ---- weapons (called by host on key press) ----
  firePrimary() {
    if (this.dead || this.overheated) return;
    const now = this.clock.getElapsedTime();
    if (now - this.lastFire < 0.1) return;
    this.lastFire = now;
    const muzzles = this.player.muzzles();
    const vel = this.player.velocity();
    const fwd = this.player.forward();
    let aimDir = fwd;
    const info = this.lockedId != null ? this.enemies.info(this.lockedId) : null;
    if (info && this.aimAssistActive) {
      const rel = info.position.clone().sub(this.player.group.position);
      const relVel = info.velocity.clone().sub(this.player.vel);
      const tHit = this.interceptTime(rel, relVel, BOLT_SPEED2);
      if (tHit != null) {
        aimDir = info.position.clone().addScaledVector(info.velocity, tHit).sub(this.player.group.position).normalize();
      }
    }
    const pair = this.cannonIdx % 2 === 0 ? [0, 3] : [1, 2];
    this.cannonIdx++;
    for (const i of pair) {
      const o = muzzles[i].addScaledVector(fwd, 24);
      this.blasters.fire(o, aimDir, vel, "player", 6);
    }
    this.laserHeat = Math.min(1.2, this.laserHeat + 0.08);
    if (this.laserHeat >= 1) this.overheated = true;
    this.onPlayerFire?.();
    if (this.onFire) {
      const bp = this.player.group.position.clone().addScaledVector(fwd, 24);
      this.onFire([bp.x, bp.y, bp.z], [fwd.x, fwd.y, fwd.z], [vel.x, vel.y, vel.z]);
    }
  }
  // ---- online multiplayer ----
  upsertRemote(id, s) {
    let r = this.remotes.get(id);
    if (!r) {
      const x = buildXWing();
      this.scene.add(x.group);
      r = { x, group: x.group, tp: new THREE11.Vector3(), tq: new THREE11.Quaternion(), sfoils: 1, boost: 0 };
      this.remotes.set(id, r);
    }
    r.tp.set(s.p[0], s.p[1], s.p[2]);
    r.tq.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    r.sfoils = s.s;
    r.boost = s.b;
  }
  removeRemote(id) {
    const r = this.remotes.get(id);
    if (r) {
      this.scene.remove(r.group);
      this.remotes.delete(id);
    }
  }
  spawnNetBolt(f) {
    this.blasters.fire(
      new THREE11.Vector3(f.o[0], f.o[1], f.o[2]),
      new THREE11.Vector3(f.d[0], f.d[1], f.d[2]),
      new THREE11.Vector3(f.v[0], f.v[1], f.v[2]),
      "enemy",
      6
    );
  }
  /** Our ship state for the network snapshot. */
  getNetState() {
    const p = this.player.group.position, q = this.player.group.quaternion, v = this.player.vel;
    return {
      p: [p.x, p.y, p.z],
      q: [q.x, q.y, q.z, q.w],
      v: [v.x, v.y, v.z],
      s: this.player.sfoilsOpen ? 1 : 0,
      b: this.player.boosting ? 1 : 0,
      t: this.lastThrottle
    };
  }
  launchTorpedo() {
    if (this.dead || this.torps <= 0) return;
    const target = this.hardLock ? this.findTargetCombatant() : null;
    if (!target) this.flash("NO LOCK \u2014 FIRING UNGUIDED", 1);
    this.torps--;
    const o = this.player.group.position.clone().addScaledVector(this.player.forward(this.tmp), 8);
    const dir = this.player.forward(this.tmp2).clone();
    this.blasters.launchTorpedo(o, dir, this.player.velocity(), target);
    this.onTorpedo?.();
  }
  cycleTarget() {
    this.lockedId = this.enemies.nearestId(this.player.group.position);
    this.lockProgress = 0;
  }
  /** Air-to-ground: laser-guided bomb onto the designated ground point. */
  launchBomb() {
    if (this.dead) return;
    if (!this.groundTarget) {
      this.flash("NO GROUND TARGET \u2014 POINT AT A SURFACE", 1.2);
      return;
    }
    if (this.torps <= 0) {
      this.flash("NO ORDNANCE", 1);
      return;
    }
    this.torps--;
    const o = this.player.group.position.clone().addScaledVector(this.player.forward(this.tmp), 8);
    const dir = this.groundTarget.clone().sub(o).normalize();
    this.blasters.launchGuidedBomb(o, dir, this.player.velocity(), this.groundTarget);
    this.flash("BOMB AWAY \u2014 LGB GUIDING", 1.2);
    this.onTorpedo?.();
  }
  /** Laser designator: march the nose ray to the surface to find a ground spot. */
  computeGroundTarget() {
    const o = this.player.group.position;
    const dir = this.player.forward(this.tmp);
    for (let d = 150; d < 14e3; d += 150) {
      const x = o.x + dir.x * d, y = o.y + dir.y * d, z = o.z + dir.z * d;
      const gh = this.surfaceHeightAt(x, z);
      if (Number.isFinite(gh) && y <= gh + 4) return new THREE11.Vector3(x, gh + 2, z);
    }
    return null;
  }
  /** Aim the pod camera: at the designated ground point if any, else a forward
   *  sensor view that follows a locked target / the nose — so the MFD is never
   *  blank. */
  updatePod() {
    this.groundTarget = this.computeGroundTarget();
    this.podCam.position.copy(this.player.group.position);
    this.podCam.up.set(0, 1, 0).applyQuaternion(this.player.group.quaternion);
    let lookAt;
    if (this.groundTarget) {
      lookAt = this.groundTarget;
    } else {
      const info = this.lockedId != null ? this.enemies.info(this.lockedId) : null;
      lookAt = info ? info.position : this.player.group.position.clone().addScaledVector(this.player.forward(this.tmp), 4e3);
    }
    this.podCam.lookAt(lookAt);
  }
  pickButton(clientX, clientY) {
    const ndc = new THREE11.Vector2(
      clientX / window.innerWidth * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.cockpit.buttons.map((b) => b.mesh), false);
    return hits.length ? hits[0].object.userData.cockpitButton : null;
  }
  /** Highlight the console button under the cursor; returns true if hovering one. */
  updateHover(clientX, clientY) {
    if (this.view !== "cockpit" || this.dead) {
      this.cockpit.setHover(null);
      return false;
    }
    const id = this.pickButton(clientX, clientY);
    this.cockpit.setHover(id);
    return id !== null;
  }
  /** Forward a pointer click in the cockpit view to the console buttons. */
  handleClick(clientX, clientY) {
    if (this.view !== "cockpit" || this.dead) return false;
    const id = this.pickButton(clientX, clientY);
    if (!id) return false;
    this.cockpit.press(id);
    this.onCockpitClick?.();
    switch (id) {
      case "SFOIL":
        this.toggleSFoils();
        break;
      case "ASSIST":
        this.toggleFlightAssist();
        break;
      case "TARGET":
        this.cycleTarget();
        break;
      case "FIRE":
        this.firePrimary();
        break;
      case "VIEW":
        this.toggleView();
        break;
      case "GEAR":
        this.toggleGear();
        break;
      case "VTOL":
        this.toggleVtol();
        break;
      case "BOMB":
        this.launchBomb();
        break;
      case "AUTO":
        this.toggleAutoLock();
        break;
    }
    return true;
  }
  /**
   * Real-world phenomena over a celestial body: a gravity well pulls you down and
   * the atmosphere applies aerodynamic drag, both fading with altitude to a
   * frictionless vacuum in open space. You must hold thrust (or hover in VTOL)
   * to stay aloft near the deck.
   */
  /** Air density 0..1 at the player (0 = vacuum, 1 = planet surface). */
  atmoDensity() {
    const d = this.tmp.copy(PLANET_CENTER3).sub(this.player.group.position).length();
    const alt = d - PLANET_R;
    if (alt < 0 || alt > ATMO_THICKNESS) return 0;
    return 1 - alt / ATMO_THICKNESS;
  }
  applyEnvironment(dt) {
    const pos = this.player.group.position;
    const toCenter = this.tmp.copy(PLANET_CENTER3).sub(pos);
    const d = toCenter.length();
    const alt = d - PLANET_R;
    if (alt < 0 || alt > ATMO_THICKNESS) return;
    const density = 1 - alt / ATMO_THICKNESS;
    this.player.vel.addScaledVector(toCenter.divideScalar(d || 1), G_SURF * density * dt);
  }
  /** Planet / Death Star surface: ground collision, landing, base repair. */
  handleSurface(dt) {
    this.landed = false;
    this.agl = null;
    const pos = this.player.group.position;
    const gh = this.surfaceHeightAt(pos.x, pos.z);
    if (!Number.isFinite(gh)) return;
    const deck = gh + 3;
    this.agl = pos.y - deck;
    if (pos.y >= deck) return;
    const speed = this.player.speed;
    const gear = this.player.gearDown;
    if (speed > 150) {
      this.damagePlayer(speed * 0.22);
      this.player.vel.multiplyScalar(0.15);
    } else if (!gear && speed > 25) {
      this.damagePlayer(speed * 0.12);
    }
    pos.y = deck;
    if (this.player.vel.y < 0) this.player.vel.y = 0;
    this.agl = 0;
    if (speed < 120) {
      if (!gear) {
        this.flash("LOWER LANDING GEAR (L)", 0.5);
        return;
      }
      this.landed = true;
      let nearPad = Infinity;
      for (const pad of this.pads) nearPad = Math.min(nearPad, Math.hypot(pos.x - pad.x, pos.z - pad.z));
      if (nearPad < 480) {
        this.hull = Math.min(100, this.hull + 24 * dt);
        this.torps = 8;
        if (this.hull > 80) this.removeDamageFire();
        this.flash("DOCKED \u2014 REPAIRING & REARMING", 0.4);
      } else {
        this.flash("LANDED \u2014 FLY TO A PAD TO REPAIR", 0.4);
      }
    }
  }
  /** Flicker the battle-damage fire and trail smoke off the hull. */
  updateDamageFx(dt) {
    if (!this.damageFire) return;
    const flame = this.damageFire.userData.flame;
    flame.scale.setScalar(0.7 + Math.random() * 0.6);
    flame.material.opacity = 0.7 + Math.random() * 0.3;
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.1;
      this.effects.spawnSmoke(flame.getWorldPosition(this.tmp).clone());
    }
  }
  toggleSFoils() {
    this.player.toggleSFoils();
  }
  toggleView() {
    this.view = this.view === "chase" ? "cockpit" : "chase";
    this.lookYaw = 0;
    this.lookPitch = 0;
  }
  toggleGear() {
    this.player.toggleGear();
  }
  toggleVtol() {
    this.player.toggleVtol();
  }
  toggleAutoLock() {
    this.autoLock = !this.autoLock;
    this.flash(this.autoLock ? "AUTO TARGET ON" : "MANUAL TARGET (T)", 1.5);
  }
  toggleFlightAssist() {
    this.player.toggleFlightAssist();
  }
  pushFeed(text, color) {
    this.feed.push({ text, color, until: this.clock.getElapsedTime() + 4.5 });
    if (this.feed.length > 6) this.feed.shift();
  }
  /** True if a world point (with its own radius) is inside the X-wing's oriented box. */
  boxHitsPoint(p, pad) {
    const local = this.tmp.copy(p).sub(this.player.group.position).applyQuaternion(this._q.copy(this.player.group.quaternion).invert());
    const h = this.playerHalf;
    return Math.abs(local.x) <= h.x + pad && Math.abs(local.y) <= h.y + pad && Math.abs(local.z) <= h.z + pad;
  }
  /**
   * Swept collision against solid bodies (obstacle boxes + celestial spheres).
   * Samples several points along the path travelled this frame so a fast ship
   * can't tunnel through thin walls.
   */
  obstacleHit() {
    const r = 9;
    const cur = this.player.group.position;
    const steps = Math.max(1, Math.ceil(this.prevPos.distanceTo(cur) / 30));
    for (let s = 0; s <= steps; s++) {
      const p = this.tmp.copy(this.prevPos).lerp(cur, s / steps);
      for (const b of this.obstacles) {
        if (b.distanceToPoint(p) < r) return true;
      }
      for (const sph of this.crashSpheres) {
        if (p.distanceTo(sph.c) < sph.r - 35) return true;
      }
      if (this.deathStarHit(p)) return true;
    }
    return false;
  }
  /** Solid Death Star, with the equatorial trench cut out so you can fly it. */
  deathStarHit(p) {
    const rel = this._dsRel.copy(p).sub(DS_SPHERE_CENTER);
    const d = rel.length();
    if (d > DS_SPHERE_R - 9 || d < 1) return false;
    const inTrench = Math.abs(rel.y) < DS_TRENCH_W - 12 && d > DS_SPHERE_R - DS_TRENCH_DEPTH;
    return !inTrench;
  }
  /**
   * Smallest positive time for a projectile of muzzle `speed` to intercept a
   * target at relative position/velocity (classic lead-fire quadratic). Returns
   * null if there's no solution (target outrunning the bolt).
   */
  interceptTime(relPos, relVel, speed) {
    const a = relVel.dot(relVel) - speed * speed;
    const b = 2 * relPos.dot(relVel);
    const c = relPos.dot(relPos);
    if (Math.abs(a) < 1e-6) {
      if (Math.abs(b) < 1e-9) return null;
      const t = -c / b;
      return t > 0 ? t : null;
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
    const cand = [t1, t2].filter((x) => x > 0).sort((x, y) => x - y);
    return cand.length ? cand[0] : null;
  }
  findTargetCombatant() {
    if (this.lockedId == null) return null;
    return this.enemies.combatants.find((c) => c.id === this.lockedId && c.alive) ?? null;
  }
  // ---- main step ----
  update(controls, dt) {
    const t = this.clock.getElapsedTime();
    this.lastThrottle = controls.throttle;
    this.effects.update(dt);
    if (this.dead) {
      if (t >= this.respawnAt) this.respawn(this.lives <= 0);
    } else {
      this.prevPos.copy(this.player.group.position);
      this.player.update(controls, dt, this.atmoDensity());
      if (controls.boost && this.player.sfoilsOpen) this.flash("FOLD S-FOILS FOR SUBLIGHT", 0.6);
      this.timeSinceHit += dt;
      this.laserHeat = Math.max(0, this.laserHeat - dt * 0.35);
      if (this.overheated && this.laserHeat < 0.3) this.overheated = false;
      this.applyEnvironment(dt);
      this.handleSurface(dt);
      this.updateDamageFx(dt);
      if (this.obstacleHit()) {
        this.flash("CRASHED INTO OBSTACLE", 2.5);
        this.killPlayer();
      }
      for (const r of this.remotes.values()) {
        if (this.boxHitsPoint(r.group.position, 11)) {
          this.flash("MID-AIR COLLISION", 2);
          this.killPlayer();
          break;
        }
      }
    }
    const boosting = this.player.boosting && !this.dead;
    this.boostVis += ((boosting ? 1 : 0) - this.boostVis) * (1 - Math.exp(-dt * 6));
    const fov = this.baseFov + this.boostVis * 22;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const playerRef = { position: this.player.group.position, velocity: this.player.velocity(this.tmp).clone(), forward: this.player.forward() };
    this.enemies.update(dt, t, playerRef, (origin, dir, ownVel) => {
      this.blasters.fire(origin, dir, ownVel, "enemy", 9);
      this.onEnemyFire?.();
    });
    const combatants = this.dead ? [...this.enemies.combatants, ...this.groundTargets.combatants] : [this.playerCombatant, ...this.enemies.combatants, ...this.groundTargets.combatants];
    this.blasters.update(dt, combatants);
    const pRef = { position: this.player.group.position, velocity: this.player.velocity(this.tmp).clone() };
    this.groundTargets.update(dt, pRef, (origin, dir) => {
      this.blasters.fire(origin, dir, this.tmp2.set(0, 0, 0), "enemy", 9);
      this.onEnemyFire?.();
    });
    if (!this.dead) {
      for (const c of [...this.enemies.combatants, ...this.groundTargets.combatants]) {
        if (!c.alive) continue;
        if (this.boxHitsPoint(c.position, c.radius)) {
          c.hit(999, c.position.clone());
          this.effects.spawnExplosion(c.position.clone(), 1.2);
          this.flash("MID-AIR COLLISION", 2);
          this.killPlayer();
          break;
        }
      }
    }
    if (this.lockedId != null && !this.enemies.info(this.lockedId)) this.lockedId = null;
    if (this.autoLock && this.lockedId == null && this.enemies.aliveCount > 0) {
      this.lockedId = this.enemies.nearestId(this.player.group.position);
      this.lockProgress = 0;
    }
    const li = this.lockedId != null ? this.enemies.info(this.lockedId) : null;
    if (li && !this.dead) {
      const to = this.tmp.copy(li.position).sub(this.player.group.position);
      const dist = to.length();
      const inCone = to.normalize().dot(this.player.forward(this.tmp2)) > 0.94;
      if (inCone && dist < 6e3) this.lockProgress = Math.min(1, this.lockProgress + dt / 1.1);
      else this.lockProgress = Math.max(0, this.lockProgress - dt * 1.5);
    } else {
      this.lockProgress = Math.max(0, this.lockProgress - dt * 2.5);
    }
    this.hardLock = this.lockProgress >= 1;
    if (this.hardLock && !this.prevHardLock) this.onLock?.();
    this.prevHardLock = this.hardLock;
    this.cockpit.setIndicator("SFOIL", this.player.sfoilsOpen);
    this.cockpit.setIndicator("ASSIST", this.player.flightAssist);
    this.cockpit.setIndicator("GEAR", this.player.gearDown);
    this.cockpit.setIndicator("AUTO", this.autoLock);
    this.cockpit.setGearLever(this.player.gearDown);
    this.cockpit.setVtolDial(this.player.vtol);
    this.cockpit.update(performance.now());
    if (this.remotes.size) {
      const k = 1 - Math.exp(-dt * 10);
      for (const r of this.remotes.values()) {
        r.group.position.lerp(r.tp, k);
        r.group.quaternion.slerp(r.tq, k);
        r.x.setSFoils(r.sfoils);
        r.x.setThrottle(r.boost ? 1 : 0.55);
      }
    }
    if (!this.dead && this.enemies.aliveCount === 0) {
      if (this.nextWaveAt === 0) {
        this.nextWaveAt = t + 3;
        this.flash("SECTOR CLEAR", 2.5);
      } else if (t >= this.nextWaveAt) {
        this.nextWaveAt = 0;
        this.startWave();
      }
    }
    this.updatePod();
    this.updateCamera();
    this.composeHud(t);
  }
  /** Drag-to-look: orbit the camera (chase) / free-look (cockpit). */
  adjustLook(dPitch, dYaw) {
    this.lookYaw += dYaw;
    this.lookPitch = Math.max(-1.3, Math.min(1.3, this.lookPitch + dPitch));
  }
  updateCamera() {
    const q = this.player.group.quaternion;
    const p = this.player.group.position;
    const inCockpit = this.view === "cockpit" && !this.dead;
    this.cockpit.group.visible = inCockpit;
    this.player.setExteriorVisible(!inCockpit);
    const lookE = new THREE11.Euler(this.lookPitch, this.lookYaw, 0, "YXZ");
    if (inCockpit) {
      const eye = this.tmp.set(0, 0.92, -0.2).applyQuaternion(q).add(p);
      const dir = this.tmp2.set(0, -0.14, -1).normalize().applyEuler(lookE).applyQuaternion(q);
      this.camera.position.copy(eye);
      this.camera.up.set(0, 1, 0).applyQuaternion(q);
      this.camera.lookAt(eye.clone().addScaledVector(dir, 200));
    } else {
      const off = this.dead ? this.tmp.set(0, 40, 160) : this.tmp.set(0, 9, 46);
      off.applyEuler(lookE).applyQuaternion(q).add(p);
      this.camera.position.copy(off);
      this.camera.up.set(0, 1, 0).applyQuaternion(q);
      this.camera.lookAt(p);
    }
    if (this.clock.getElapsedTime() < this.shakeUntil) {
      const m = this.shakeMag;
      this.camera.position.x += (Math.random() - 0.5) * m;
      this.camera.position.y += (Math.random() - 0.5) * m;
      this.camera.position.z += (Math.random() - 0.5) * m;
    }
  }
  /** Project a world point to screen pixels; behind=true if it's behind camera. */
  project(world) {
    const v = world.clone().project(this.camera);
    return {
      x: (v.x + 1) / 2 * window.innerWidth,
      y: (1 - v.y) / 2 * window.innerHeight,
      behind: v.z > 1
    };
  }
  composeHud(t) {
    const h = this.hud;
    h.speed = this.player.speed;
    h.throttle = this.lastThrottle;
    h.flightAssist = this.player.flightAssist;
    h.hull = Math.max(0, Math.round(this.hull));
    h.shields = 0;
    h.score = this.score;
    h.wave = this.wave;
    h.lives = this.lives;
    h.enemiesLeft = this.enemies.aliveCount;
    h.sfoils = this.player.sfoilsOpen;
    h.torps = this.torps;
    h.laserHeat = Math.min(1, this.laserHeat);
    h.boost = this.boostVis;
    h.view = this.view;
    h.agl = this.agl;
    h.landed = this.landed;
    h.gear = this.player.gearDown;
    h.vtol = this.player.vtol;
    h.inAtmo = this.player.inAtmo;
    h.aoa = this.player.aoaDeg;
    h.gLoad = this.player.gLoad;
    h.stalled = this.player.stalled;
    this.feed = this.feed.filter((f) => f.until > t);
    h.feed = this.feed.map((f) => ({ text: f.text, color: f.color, alpha: Math.min(1, (f.until - t) / 0.8) }));
    h.a2g = null;
    if (this.groundTarget) {
      const pr = this.project(this.groundTarget);
      h.a2g = { x: pr.x, y: pr.y, behind: pr.behind, dist: this.groundTarget.distanceTo(this.player.group.position) };
    }
    h.message = t < this.messageUntil ? this.message : this.overheated ? "LASERS OVERHEATED" : void 0;
    h.target = void 0;
    h.lock = void 0;
    const pp = this.player.group.position;
    h.prograde = void 0;
    h.gunReticle = void 0;
    if (this.player.vel.lengthSq() > 1) {
      const pg = this.project(this.tmp.copy(this.player.vel).normalize().multiplyScalar(3e3).add(pp));
      h.prograde = { x: pg.x, y: pg.y, behind: pg.behind };
    }
    const boltVel = this.player.forward().multiplyScalar(BOLT_SPEED2).add(this.player.vel).normalize();
    const gr = this.project(boltVel.multiplyScalar(3e3).add(pp));
    h.gunReticle = { x: gr.x, y: gr.y, behind: gr.behind };
    const info = this.lockedId != null ? this.enemies.info(this.lockedId) : null;
    if (info) {
      h.lock = { state: this.hardLock ? "locked" : "searching", progress: this.lockProgress };
      const box = this.project(info.position);
      const dist = info.position.distanceTo(pp);
      const relPos = info.position.clone().sub(pp);
      const relVel = info.velocity.clone().sub(this.player.vel);
      const tHit = this.interceptTime(relPos, relVel, BOLT_SPEED2);
      let lead;
      if (tHit != null && !box.behind) {
        const lp = this.project(info.position.clone().addScaledVector(info.velocity, tHit));
        if (!lp.behind) lead = { x: lp.x, y: lp.y };
      }
      h.target = { x: box.x, y: box.y, dist, behind: box.behind, lead };
      const R = 70;
      const inside = !box.behind && !gr.behind && dist < 3700 && Math.hypot(box.x - gr.x, box.y - gr.y) < R;
      this.aimAssistActive = inside;
      if (!box.behind) h.assistCircle = { x: box.x, y: box.y, r: R, active: inside };
      const los = relPos.clone().normalize();
      h.closure = -relVel.dot(los);
      h.gunRange = GUN_RMAX;
      h.shoot = inside && dist < GUN_RMAX;
    } else {
      this.aimAssistActive = false;
      h.closure = void 0;
      h.shoot = false;
      h.gunRange = void 0;
    }
    const fwd2 = this.player.forward(this.tmp);
    h.heading = (Math.atan2(fwd2.x, -fwd2.z) * 180 / Math.PI + 360) % 360;
    this.updateRadar();
    h.blips = this.blips;
    this.cockpit.setBars(this.hull, Math.min(1, h.throttle));
  }
  /** Build player-local radar blips and refresh the cockpit scope texture. */
  updateRadar() {
    const inv = this._q.copy(this.player.group.quaternion).invert();
    const pp = this.player.group.position;
    this.blips.length = 0;
    for (const c of this.enemies.combatants) {
      if (!c.alive) continue;
      const rel = this.tmp.copy(c.position).sub(pp).applyQuaternion(inv);
      const n = Math.min(1, rel.length() / this.RADAR_RANGE);
      const horiz = Math.atan2(rel.x, -rel.z);
      this.blips.push({
        rx: Math.sin(horiz) * n,
        ry: -Math.cos(horiz) * n,
        elev: rel.y,
        locked: c.id === this.lockedId
      });
    }
    const ctx = this.scopeCtx;
    ctx.clearRect(0, 0, 256, 256);
    drawRadar(ctx, 128, 128, 116, this.blips, this.clock.getElapsedTime());
    this.cockpit.scopeTex.needsUpdate = true;
  }
  getHud() {
    return this.hud;
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  render() {
    if (this.view === "cockpit" && !this.dead) {
      const prevV = this.player.group.visible;
      this.player.group.visible = false;
      this.renderer.setRenderTarget(this.tvTarget);
      this.renderer.clear();
      this.renderer.render(this.scene, this.podCam);
      this.renderer.setRenderTarget(null);
      this.player.group.visible = prevV;
    }
    this.composer.render();
  }
};

// src/web/hud.ts
var AMBER = "#ffb627";
var CYAN = "#46d8ff";
var RED2 = "#ff4533";
var GREEN = "#5dff7a";
var HUD = class {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }
  canvas;
  ctx;
  time = 0;
  // Stable per-streak angle + phase so the speed lines don't flicker randomly.
  streaks = Array.from({ length: 60 }, () => ({
    ang: Math.random() * Math.PI * 2,
    phase: Math.random(),
    speed: 0.6 + Math.random() * 1.2
  }));
  /** Radial "jump to lightspeed" streaks while the sublight accelerator is on. */
  drawStreaks(cx, cy, intensity) {
    if (intensity < 0.02) return;
    const ctx = this.ctx;
    const maxR = Math.hypot(cx, cy);
    ctx.save();
    ctx.lineCap = "round";
    for (const s of this.streaks) {
      const p = (s.phase + this.time * s.speed) % 1;
      const inner = (0.12 + p * 0.9) * maxR;
      const len = (40 + p * 260) * intensity;
      const ca = Math.cos(s.ang), sa = Math.sin(s.ang);
      const a = Math.min(1, intensity) * Math.min(1, p * 2) * (1 - p) * 2.2;
      ctx.strokeStyle = `rgba(170,225,255,${Math.max(0, Math.min(0.9, a))})`;
      ctx.lineWidth = 1 + intensity * 2;
      ctx.beginPath();
      ctx.moveTo(cx + ca * inner, cy + sa * inner);
      ctx.lineTo(cx + ca * (inner + len), cy + sa * (inner + len));
      ctx.stroke();
    }
    ctx.restore();
  }
  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }
  draw(d) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    this.time += 0.016;
    this.drawStreaks(cx, cy, d.boost);
    ctx.lineWidth = 2;
    ctx.font = "15px monospace";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = CYAN;
    ctx.beginPath();
    ctx.moveTo(cx - 26, cy);
    ctx.lineTo(cx - 9, cy);
    ctx.moveTo(cx + 9, cy);
    ctx.lineTo(cx + 26, cy);
    ctx.moveTo(cx, cy - 26);
    ctx.lineTo(cx, cy - 9);
    ctx.moveTo(cx, cy + 9);
    ctx.lineTo(cx, cy + 26);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.stroke();
    if (d.gunReticle && !d.gunReticle.behind) {
      const g = d.gunReticle;
      const rad = 26;
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(g.x, g.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = GREEN;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      if (d.gunRange && d.target && !d.target.behind) {
        const frac = Math.max(0, Math.min(1, 1 - d.target.dist / d.gunRange));
        if (frac > 0) {
          ctx.strokeStyle = d.shoot ? RED2 : GREEN;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(g.x, g.y, rad + 5, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
          ctx.stroke();
        }
      }
      if (d.shoot) {
        ctx.fillStyle = RED2;
        ctx.font = "bold 18px monospace";
        ctx.textAlign = "center";
        ctx.fillText("SHOOT", g.x, g.y - rad - 16);
        ctx.font = "15px monospace";
      }
      ctx.lineWidth = 2;
    }
    if (d.prograde && !d.prograde.behind) {
      const p = d.prograde;
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 7, p.y);
      ctx.lineTo(p.x - 13, p.y);
      ctx.moveTo(p.x + 7, p.y);
      ctx.lineTo(p.x + 13, p.y);
      ctx.moveTo(p.x, p.y - 7);
      ctx.lineTo(p.x, p.y - 13);
      ctx.stroke();
    }
    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;
    ctx.lineWidth = 1.5;
    ctx.font = "20px monospace";
    ctx.textAlign = "right";
    ctx.strokeRect(cx - 210, cy - 18, 78, 36);
    ctx.fillText(`${Math.round(d.speed)}`, cx - 138, cy);
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("M/S", cx - 171, cy - 28);
    ctx.lineWidth = 2;
    if (d.assistCircle) {
      const a = d.assistCircle;
      ctx.strokeStyle = a.active ? GREEN : "rgba(150,170,185,0.5)";
      ctx.lineWidth = a.active ? 2.5 : 1.5;
      ctx.setLineDash(a.active ? [] : [5, 5]);
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
    }
    if (d.target) {
      if (d.target.behind || d.target.x < 0 || d.target.x > W || d.target.y < 0 || d.target.y > H) {
        const ang = Math.atan2(d.target.y - cy, d.target.x - cx) + (d.target.behind ? Math.PI : 0);
        const r = Math.min(W, H) * 0.34;
        const ax = cx + Math.cos(ang) * r, ay = cy + Math.sin(ang) * r;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(ang);
        ctx.strokeStyle = AMBER;
        ctx.fillStyle = AMBER;
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-8, -8);
        ctx.lineTo(-8, 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        const { x, y, dist } = d.target;
        const inRange = dist < 3200;
        ctx.strokeStyle = inRange ? RED2 : AMBER;
        const s = 22;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.moveTo(x + sx * s, y + sy * s - sy * 8);
          ctx.lineTo(x + sx * s, y + sy * s);
          ctx.lineTo(x + sx * s - sx * 8, y + sy * s);
        }
        ctx.stroke();
        ctx.fillStyle = inRange ? RED2 : AMBER;
        ctx.textAlign = "left";
        ctx.fillText(`${Math.round(dist)}m`, x + s + 4, y - s);
        if (d.closure != null) {
          const c = Math.round(d.closure);
          ctx.fillText(`${c >= 0 ? "+" : ""}${c} m/s`, x + s + 4, y - s + 18);
        }
        if (d.target.lead) {
          ctx.strokeStyle = GREEN;
          ctx.beginPath();
          ctx.arc(d.target.lead.x, d.target.lead.y, 7, 0, Math.PI * 2);
          ctx.moveTo(d.target.lead.x - 11, d.target.lead.y);
          ctx.lineTo(d.target.lead.x + 11, d.target.lead.y);
          ctx.moveTo(d.target.lead.x, d.target.lead.y - 11);
          ctx.lineTo(d.target.lead.x, d.target.lead.y + 11);
          ctx.stroke();
        }
        if (d.lock) {
          ctx.textAlign = "center";
          if (d.lock.state === "locked") {
            ctx.strokeStyle = RED2;
            ctx.fillStyle = RED2;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, y - 30);
            ctx.lineTo(x + 30, y);
            ctx.lineTo(x, y + 30);
            ctx.lineTo(x - 30, y);
            ctx.closePath();
            ctx.stroke();
            ctx.font = "bold 13px monospace";
            ctx.fillText("\u25C9 LOCK \u2014 MISSILE READY", x, y - 40);
            ctx.font = "15px monospace";
          } else if (d.lock.progress > 0.01) {
            const g = 34 - d.lock.progress * 12;
            ctx.strokeStyle = AMBER;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - g, y - g + 9);
            ctx.lineTo(x - g, y - g);
            ctx.lineTo(x - g + 9, y - g);
            ctx.moveTo(x + g, y - g + 9);
            ctx.lineTo(x + g, y - g);
            ctx.lineTo(x + g - 9, y - g);
            ctx.moveTo(x + g, y + g - 9);
            ctx.lineTo(x + g, y + g);
            ctx.lineTo(x + g - 9, y + g);
            ctx.moveTo(x - g, y + g - 9);
            ctx.lineTo(x - g, y + g);
            ctx.lineTo(x - g + 9, y + g);
            ctx.stroke();
            ctx.fillStyle = AMBER;
            ctx.font = "12px monospace";
            ctx.fillText(`LOCKING ${Math.round(d.lock.progress * 100)}%`, x, y + g + 16);
            ctx.font = "15px monospace";
          }
        }
      }
    }
    this.bar(30, H - 92, "HULL", d.hull / 100, d.hull > 30 ? GREEN : RED2);
    this.bar(30, H - 64, "LASER", 1 - d.laserHeat, d.laserHeat > 0.8 ? RED2 : AMBER);
    if (d.agl != null && Number.isFinite(d.agl)) {
      ctx.textAlign = "left";
      ctx.fillStyle = d.agl < 200 ? RED2 : AMBER;
      ctx.font = "15px monospace";
      ctx.fillText(`AGL ${Math.max(0, Math.round(d.agl))}`, 30, H - 150);
      if (d.landed) {
        ctx.fillStyle = GREEN;
        ctx.fillText("\u25CF LANDED", 110, H - 150);
      }
    }
    if (d.inAtmo) {
      ctx.textAlign = "left";
      ctx.font = "15px monospace";
      const g = d.gLoad ?? 1, aoa = d.aoa ?? 0;
      ctx.fillStyle = g > 7.5 ? RED2 : GREEN;
      ctx.fillText(`G ${g.toFixed(1)}`, 30, H - 200);
      ctx.fillStyle = aoa > 22 ? RED2 : aoa > 14 ? AMBER : GREEN;
      ctx.fillText(`AOA ${Math.round(aoa)}\xB0`, 30, H - 178);
      if (d.prograde && !d.prograde.behind) {
        const p = d.prograde, bx = p.x - 26;
        const onSpeed = aoa >= 6 && aoa <= 10;
        ctx.strokeStyle = onSpeed ? GREEN : aoa > 10 ? RED2 : AMBER;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx - 8, p.y - 9);
        ctx.lineTo(bx, p.y);
        ctx.lineTo(bx - 8, p.y + 9);
        ctx.stroke();
      }
      if (d.stalled) {
        ctx.fillStyle = RED2;
        ctx.font = "bold 22px monospace";
        ctx.textAlign = "center";
        ctx.fillText("STALL", cx, cy + 150);
        ctx.font = "15px monospace";
      }
    }
    ctx.strokeStyle = AMBER;
    ctx.fillStyle = AMBER;
    ctx.textAlign = "center";
    const tW = 220, tx = cx - tW / 2, ty = H - 36;
    ctx.strokeRect(tx, ty, tW, 12);
    ctx.fillRect(tx, ty, tW * Math.max(0, Math.min(1, d.throttle)), 12);
    ctx.fillText(`THR ${Math.round(d.throttle * 100)}%   ${Math.round(d.speed)} m/s   S-FOILS ${d.sfoils ? "ATTACK" : "CRUISE"}`, cx, ty - 14);
    ctx.fillStyle = d.flightAssist ? CYAN : RED2;
    ctx.font = "bold 14px monospace";
    ctx.fillText(`FLIGHT ASSIST ${d.flightAssist ? "ON" : "OFF \u2014 NEWTONIAN"}`, cx, ty + 24);
    ctx.font = "15px monospace";
    const states = [];
    if (d.gear) states.push("GEAR DOWN");
    if (d.vtol) states.push("VTOL");
    if (states.length) {
      ctx.fillStyle = GREEN;
      ctx.font = "bold 14px monospace";
      ctx.fillText(states.join("   "), cx, ty + 42);
      ctx.font = "15px monospace";
    }
    ctx.fillStyle = AMBER;
    if (d.boost > 0.3) {
      ctx.fillStyle = CYAN;
      ctx.font = "bold 16px monospace";
      ctx.fillText("\u25B6 SUBLIGHT ACCELERATOR \u25C0", cx, cy + 90);
      ctx.font = "15px monospace";
    }
    ctx.textAlign = "right";
    ctx.fillStyle = AMBER;
    ctx.font = "18px monospace";
    ctx.fillText(`SCORE ${d.score}`, W - 24, 28);
    ctx.font = "15px monospace";
    ctx.fillStyle = CYAN;
    ctx.fillText(`WAVE ${d.wave}`, W - 24, 54);
    ctx.fillText(`TIE x${d.enemiesLeft}`, W - 24, 76);
    ctx.fillStyle = GREEN;
    ctx.fillText(`X-WINGS ${d.lives}`, W - 24, 98);
    ctx.fillStyle = CYAN;
    ctx.fillText(`A2G BOMB x${d.torps}`, W - 24, 120);
    if (d.feed && d.feed.length) {
      const rows = d.feed.slice().reverse();
      const rowH = 30, padX = 16, padY = 12;
      const boxW = 320, boxH = rows.length * rowH + padY * 2;
      const bx = W - boxW - 20, by = 150;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#2a3642";
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.restore();
      ctx.textAlign = "left";
      ctx.font = "bold 18px monospace";
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        ctx.globalAlpha = r.alpha;
        ctx.fillStyle = r.color;
        ctx.fillText(r.text, bx + padX, by + padY + rowH / 2 + i * rowH);
      }
      ctx.globalAlpha = 1;
      ctx.font = "15px monospace";
    }
    if (d.a2g && !d.a2g.behind) {
      const g = d.a2g;
      ctx.strokeStyle = "#ff8c1a";
      ctx.fillStyle = "#ff8c1a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(g.x - 20, g.y);
      ctx.lineTo(g.x - 8, g.y);
      ctx.moveTo(g.x + 8, g.y);
      ctx.lineTo(g.x + 20, g.y);
      ctx.moveTo(g.x, g.y - 20);
      ctx.lineTo(g.x, g.y - 8);
      ctx.moveTo(g.x, g.y + 8);
      ctx.lineTo(g.x, g.y + 20);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.font = "12px monospace";
      ctx.fillText(`A/G ${Math.round(g.dist)}`, g.x + 18, g.y - 14);
      ctx.font = "15px monospace";
    }
    const rR = Math.min(96, Math.min(W, H) * 0.14);
    const rcx = W - rR - 30, rcy = H - rR - 30;
    drawRadar(ctx, rcx, rcy, rR, d.blips, this.time);
    ctx.fillStyle = GREEN;
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SENSORS", rcx, rcy - rR - 8);
    ctx.font = "15px monospace";
    if (d.message) {
      ctx.textAlign = "center";
      ctx.fillStyle = d.message.includes("OVER") || d.message.includes("HIT") || d.message.includes("GAME") ? RED2 : AMBER;
      ctx.font = "bold 24px monospace";
      ctx.fillText(d.message, cx, cy - 120);
      ctx.font = "15px monospace";
    }
  }
  bar(x, y, label, frac, color) {
    const ctx = this.ctx;
    const w = 180, h = 14;
    ctx.textAlign = "left";
    ctx.fillStyle = "#cfe3ee";
    ctx.font = "13px monospace";
    ctx.fillText(label, x, y - 9);
    ctx.strokeStyle = "#2a3742";
    ctx.strokeRect(x + 64, y - 16, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x + 64, y - 16, w * Math.max(0, Math.min(1, frac)), h);
    ctx.font = "15px monospace";
  }
};

// src/web/audio.ts
var AudioEngine = class {
  ctx = null;
  master;
  // Engine: two detuned saw oscillators (core + fan whine) + filtered noise.
  fanOsc;
  coreOsc;
  engineGain;
  whineFilter;
  // Afterburner: low-frequency rumble (noise through a lowpass).
  abGain;
  // Wind / airflow noise.
  windGain;
  windFilter;
  noiseBuf;
  started = false;
  // Sampled engine bed (LEGO Star Wars X-wing engine clip) — loops, and its
  // level + pitch follow throttle. Replaces the synth engine once loaded.
  engineSampleGain = null;
  engineSampleSrc = null;
  engineSampleBuf = null;
  engineSampleReady = false;
  // Sampled blaster (LEGO X-wing fire clip) — a fresh one-shot voice per shot.
  fireBuf = null;
  // Sampled TIE-fighter cannon clip.
  tieFireBuf = null;
  /** Must be called from a user gesture (click/keydown) to satisfy autoplay. */
  start() {
    if (this.started) return;
    this.started = true;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);
    const n = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);
    this.fanOsc = ctx.createOscillator();
    this.fanOsc.type = "sawtooth";
    this.fanOsc.frequency.value = 120;
    this.coreOsc = ctx.createOscillator();
    this.coreOsc.type = "sawtooth";
    this.coreOsc.frequency.value = 240;
    this.whineFilter = ctx.createBiquadFilter();
    this.whineFilter.type = "bandpass";
    this.whineFilter.frequency.value = 2200;
    this.whineFilter.Q.value = 4;
    const engineNoise = ctx.createBufferSource();
    engineNoise.buffer = this.noiseBuf;
    engineNoise.loop = true;
    engineNoise.connect(this.whineFilter);
    this.whineFilter.connect(this.engineGain);
    this.fanOsc.connect(this.engineGain);
    this.coreOsc.connect(this.engineGain);
    this.abGain = ctx.createGain();
    this.abGain.gain.value = 0;
    this.abGain.connect(this.master);
    const abNoise = ctx.createBufferSource();
    abNoise.buffer = this.noiseBuf;
    abNoise.loop = true;
    const abFilter = ctx.createBiquadFilter();
    abFilter.type = "lowpass";
    abFilter.frequency.value = 320;
    abNoise.connect(abFilter);
    abFilter.connect(this.abGain);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(this.master);
    const windNoise = ctx.createBufferSource();
    windNoise.buffer = this.noiseBuf;
    windNoise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 600;
    windNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.fanOsc.start();
    this.coreOsc.start();
    engineNoise.start();
    abNoise.start();
    windNoise.start();
    this.engineSampleGain = ctx.createGain();
    this.engineSampleGain.gain.value = 0;
    this.engineSampleGain.connect(this.master);
    this.loadEngineSample("./assets/engine.mp3");
    fetch("./assets/fire.mp3").then((r) => r.arrayBuffer()).then((d) => this.ctx.decodeAudioData(d)).then((buf) => {
      this.fireBuf = buf;
    }).catch(() => {
      this.fireBuf = null;
    });
    fetch("./assets/tie-blast.mp3").then((r) => r.arrayBuffer()).then((d) => this.ctx.decodeAudioData(d)).then((buf) => {
      this.tieFireBuf = buf;
    }).catch(() => {
      this.tieFireBuf = null;
    });
  }
  /** Fetch + decode the engine clip and start it looping (gain/pitch follow throttle). */
  async loadEngineSample(url) {
    if (!this.ctx) return;
    try {
      const res = await fetch(url);
      const data = await res.arrayBuffer();
      this.engineSampleBuf = await this.ctx.decodeAudioData(data);
      const src = this.ctx.createBufferSource();
      src.buffer = this.engineSampleBuf;
      src.loop = true;
      src.connect(this.engineSampleGain);
      src.start();
      this.engineSampleSrc = src;
      this.engineSampleReady = true;
    } catch {
      this.engineSampleReady = false;
    }
  }
  /**
   * Update the soundscape from flight state.
   * @param powerPct engine power level state, 0..100
   * @param throttle commanded throttle 0..1
   * @param mach Mach number (drives wind/airflow)
   */
  update(powerPct, throttle, mach) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = powerPct / 100;
    if (this.engineSampleReady && this.engineSampleSrc && this.engineSampleGain) {
      this.engineGain.gain.setTargetAtTime(0, t, 0.2);
      this.engineSampleGain.gain.setTargetAtTime(0.35 + rpm * 0.5, t, 0.2);
      this.engineSampleSrc.playbackRate.setTargetAtTime(0.85 + rpm * 0.5, t, 0.2);
    } else {
      const fanF = 90 + rpm * 320;
      this.fanOsc.frequency.setTargetAtTime(fanF, t, 0.15);
      this.coreOsc.frequency.setTargetAtTime(fanF * 2.02, t, 0.15);
      this.whineFilter.frequency.setTargetAtTime(1500 + rpm * 4500, t, 0.2);
      this.engineGain.gain.setTargetAtTime(0.08 + rpm * 0.32, t, 0.2);
    }
    const ab = Math.max(0, (throttle - 0.85) / 0.15);
    this.abGain.gain.setTargetAtTime(ab * 0.5, t, 0.1);
    const w = Math.min(1, mach / 1.5);
    this.windGain.gain.setTargetAtTime(w * w * 0.25, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(400 + w * 3e3, t, 0.2);
  }
  /** Short synthesized switch click for UI/cockpit interactions. */
  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "square";
    o.frequency.value = 1400;
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 2e-3);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.05);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.06);
  }
  /** Single cannon round (called rapidly while firing). */
  gunShot() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 900;
    f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.06);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 0.07);
  }
  /** Missile motor whoosh. */
  missileLaunch() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(2e3, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.7);
    f.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.9);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 0.95);
  }
  /** Explosion boom. */
  explosion() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(800, t);
    f.frequency.exponentialRampToValueAtTime(80, t + 0.8);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 1.1);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 1.2);
  }
  /** Player blaster cannon: the LEGO X-wing fire clip (synth "pew" fallback). */
  laser() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.fireBuf) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.fireBuf;
      src.playbackRate.value = 0.95 + Math.random() * 0.12;
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.6;
      src.connect(g2);
      g2.connect(this.master);
      src.start(t);
      return;
    }
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(280, t + 0.12);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.14);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }
  /** Enemy TIE cannon: the sampled blast clip (synth fallback). */
  enemyLaser() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.tieFireBuf) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.tieFireBuf;
      src.playbackRate.value = 0.9 + Math.random() * 0.14;
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.5;
      src.connect(g2);
      g2.connect(this.master);
      src.start(t);
      return;
    }
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(700, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.16);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.18);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.19);
  }
  /** Proton torpedo launch whoosh (reuses the missile synth). */
  torpedo() {
    this.missileLaunch();
  }
  /** Short rising beep when the radar acquires a hard lock. */
  lockTone() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(1700, t + 0.12);
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.22);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.24);
  }
  /** Soft search blip while the lock is building. */
  lockSearch() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "square";
    o.frequency.value = 720;
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.06);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.07);
  }
  /** Warning tone (e.g. overstress / stall). */
  warning() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sawtooth";
    o.frequency.value = 880;
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.25);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.26);
  }
};

// src/web/input.ts
var InputManager = class {
  keys = /* @__PURE__ */ new Set();
  throttle = 0.55;
  // Touch / on-screen controls (set by the mobile UI). Axes are -1..1, throttle
  // is absolute 0..1 (or null to leave keyboard in charge), gun/boost are held.
  touch = {
    active: false,
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: null,
    gun: false,
    boost: false
  };
  onTorpedo = null;
  onBomb = null;
  onTarget = null;
  onView = null;
  onSFoils = null;
  onFlightAssist = null;
  onGear = null;
  onVtol = null;
  onAutoLock = null;
  onFirstGesture = null;
  gestureFired = false;
  attach(el2 = window) {
    el2.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      const fresh = !this.keys.has(k);
      this.keys.add(k);
      if (!this.gestureFired) {
        this.gestureFired = true;
        this.onFirstGesture?.();
      }
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
    el2.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    el2.addEventListener("pointerdown", () => {
      if (!this.gestureFired) {
        this.gestureFired = true;
        this.onFirstGesture?.();
      }
    });
  }
  k(...names) {
    return names.some((n) => this.keys.has(n));
  }
  sample(dt) {
    if (this.k("shift")) this.throttle = Math.min(1, this.throttle + 0.6 * dt);
    if (this.k("control", "ctrl")) this.throttle = Math.max(0, this.throttle - 0.6 * dt);
    let pitch = 0, roll = 0, yaw = 0;
    if (this.k("w", "arrowup")) pitch += 1;
    if (this.k("s", "arrowdown")) pitch -= 1;
    if (this.k("d", "arrowright")) roll += 1;
    if (this.k("a", "arrowleft")) roll -= 1;
    if (this.k("e")) yaw += 1;
    if (this.k("q")) yaw -= 1;
    let boost = this.k("z");
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p) => p);
    if (pad) {
      const dz = (v) => Math.abs(v) < 0.08 ? 0 : v;
      const gpRoll = dz(pad.axes[0] ?? 0);
      const gpPitch = dz(pad.axes[1] ?? 0);
      const gpYaw = dz(pad.axes[2] ?? 0);
      if (gpRoll) roll = gpRoll;
      if (gpPitch) pitch = -gpPitch;
      if (gpYaw) yaw = gpYaw;
      if (pad.buttons[7]?.pressed) boost = true;
    }
    if (this.touch.active) {
      if (this.touch.pitch) pitch = this.touch.pitch;
      if (this.touch.roll) roll = this.touch.roll;
      if (this.touch.yaw) yaw = this.touch.yaw;
      if (this.touch.boost) boost = true;
      if (this.touch.throttle != null) this.throttle = this.touch.throttle;
    }
    return {
      pitch: Math.max(-1, Math.min(1, pitch)),
      roll: Math.max(-1, Math.min(1, roll)),
      yaw: Math.max(-1, Math.min(1, yaw)),
      throttle: this.throttle,
      boost
    };
  }
  get gunHeld() {
    return this.keys.has(" ") || this.touch.gun;
  }
};

// src/web/net.ts
var Net = class {
  ws = null;
  id = 0;
  connected = false;
  onWelcome = null;
  onState = null;
  onFire = null;
  onLeave = null;
  onCount = null;
  connect(url) {
    try {
      this.ws = new WebSocket(url);
    } catch {
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
    };
    this.ws.onclose = () => {
      this.connected = false;
    };
    this.ws.onerror = () => {
      this.connected = false;
    };
    this.ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (m.t ?? m.mt) {
        case "welcome":
          this.id = m.id;
          this.onWelcome?.(m.id);
          break;
        case "s":
          this.onState?.(m.id, m.s);
          break;
        case "f":
          this.onFire?.(m.id, m.f);
          break;
        case "leave":
          this.onLeave?.(m.id);
          break;
      }
    };
  }
  send(obj) {
    if (this.connected && this.ws) this.ws.send(JSON.stringify(obj));
  }
  sendState(s) {
    this.send({ mt: "s", s });
  }
  sendFire(f) {
    this.send({ mt: "f", f });
  }
};

// src/web/mobile.ts
function isTouchDevice() {
  return typeof window !== "undefined" && ("ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0);
}
function el(tag, style, text) {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  if (text) e.textContent = text;
  return e;
}
var BTN_BASE = {
  position: "absolute",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "monospace",
  fontWeight: "bold",
  fontSize: "13px",
  color: "#ffe27a",
  background: "rgba(20,28,36,0.55)",
  border: "2px solid #ffb627",
  borderRadius: "10px",
  userSelect: "none",
  touchAction: "none",
  textAlign: "center",
  lineHeight: "1.1"
};
function setupMobileControls(input2) {
  if (!isTouchDevice()) return;
  input2.touch.active = true;
  const help = document.getElementById("help");
  if (help) help.style.display = "none";
  const root = el("div", {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "20",
    touchAction: "none"
  });
  document.body.appendChild(root);
  const R = 70;
  const base = el("div", {
    position: "absolute",
    left: "24px",
    bottom: "24px",
    width: `${R * 2}px`,
    height: `${R * 2}px`,
    borderRadius: "50%",
    background: "rgba(20,28,36,0.45)",
    border: "2px solid #46d8ff",
    pointerEvents: "auto",
    touchAction: "none"
  });
  const knob = el("div", {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "62px",
    height: "62px",
    marginLeft: "-31px",
    marginTop: "-31px",
    borderRadius: "50%",
    background: "rgba(70,216,255,0.5)",
    border: "2px solid #cfeefe"
  });
  base.appendChild(knob);
  root.appendChild(base);
  let stickId = -1;
  const stickMove = (cx, cy) => {
    const r = base.getBoundingClientRect();
    let dx = cx - (r.left + R), dy = cy - (r.top + R);
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = dx / len * R;
      dy = dy / len * R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input2.touch.roll = dx / R;
    input2.touch.pitch = -dy / R;
  };
  const stickEnd = () => {
    stickId = -1;
    knob.style.transform = "translate(0,0)";
    input2.touch.roll = 0;
    input2.touch.pitch = 0;
  };
  base.addEventListener("pointerdown", (e) => {
    stickId = e.pointerId;
    base.setPointerCapture(e.pointerId);
    stickMove(e.clientX, e.clientY);
    e.preventDefault();
  });
  base.addEventListener("pointermove", (e) => {
    if (e.pointerId === stickId) {
      stickMove(e.clientX, e.clientY);
      e.preventDefault();
    }
  });
  base.addEventListener("pointerup", (e) => {
    if (e.pointerId === stickId) stickEnd();
  });
  base.addEventListener("pointercancel", () => stickEnd());
  const tH = 200;
  const tTrack = el("div", {
    position: "absolute",
    right: "30px",
    bottom: "30px",
    width: "54px",
    height: `${tH}px`,
    background: "rgba(20,28,36,0.45)",
    border: "2px solid #ffb627",
    borderRadius: "27px",
    pointerEvents: "auto",
    touchAction: "none"
  });
  const tKnob = el("div", {
    position: "absolute",
    left: "3px",
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    background: "rgba(255,182,39,0.6)",
    border: "2px solid #ffe27a",
    bottom: "0px"
  });
  const tLabel = el("div", { position: "absolute", right: "30px", bottom: `${30 + tH + 6}px`, width: "54px", textAlign: "center", fontFamily: "monospace", fontSize: "11px", color: "#ffb627" }, "THR");
  tTrack.appendChild(tKnob);
  root.appendChild(tTrack);
  root.appendChild(tLabel);
  const setThrottle = (cy) => {
    const r = tTrack.getBoundingClientRect();
    let f = 1 - (cy - r.top) / r.height;
    f = Math.max(0, Math.min(1, f));
    input2.touch.throttle = f;
    tKnob.style.bottom = `${f * (tH - 44)}px`;
  };
  let tId = -1;
  tTrack.addEventListener("pointerdown", (e) => {
    tId = e.pointerId;
    tTrack.setPointerCapture(e.pointerId);
    setThrottle(e.clientY);
    e.preventDefault();
  });
  tTrack.addEventListener("pointermove", (e) => {
    if (e.pointerId === tId) {
      setThrottle(e.clientY);
      e.preventDefault();
    }
  });
  tTrack.addEventListener("pointerup", (e) => {
    if (e.pointerId === tId) tId = -1;
  });
  input2.touch.throttle = 0.55;
  tKnob.style.bottom = `${0.55 * (tH - 44)}px`;
  const holdBtn = (label, css, onDown, onUp, color = "#ffb627") => {
    const b = el("div", { ...BTN_BASE, ...css, pointerEvents: "auto", borderColor: color, color }, label);
    const down = (e) => {
      b.style.background = "rgba(255,182,39,0.35)";
      onDown();
      e.preventDefault();
    };
    const up = () => {
      b.style.background = "rgba(20,28,36,0.55)";
      onUp();
    };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("pointerleave", up);
    root.appendChild(b);
    return b;
  };
  const tapBtn = (label, css, action, color = "#ffe27a") => {
    const b = el("div", { ...BTN_BASE, ...css, pointerEvents: "auto", borderColor: color, color }, label);
    b.addEventListener("pointerdown", (e) => {
      b.style.background = "rgba(255,182,39,0.35)";
      action();
      e.preventDefault();
    });
    b.addEventListener("pointerup", () => {
      b.style.background = "rgba(20,28,36,0.55)";
    });
    root.appendChild(b);
    return b;
  };
  holdBtn(
    "FIRE",
    { right: "100px", bottom: "40px", width: "92px", height: "92px", borderRadius: "50%", fontSize: "18px", color: "#ff5544", borderColor: "#ff5544" },
    () => {
      input2.touch.gun = true;
    },
    () => {
      input2.touch.gun = false;
    },
    "#ff5544"
  );
  holdBtn(
    "BOOST",
    { right: "210px", bottom: "60px", width: "78px", height: "60px" },
    () => {
      input2.touch.boost = true;
    },
    () => {
      input2.touch.boost = false;
    },
    "#46d8ff"
  );
  holdBtn(
    "\u25C4 YAW",
    { left: "180px", bottom: "30px", width: "66px", height: "52px" },
    () => {
      input2.touch.yaw = -1;
    },
    () => {
      input2.touch.yaw = 0;
    }
  );
  holdBtn(
    "YAW \u25BA",
    { left: "180px", bottom: "92px", width: "66px", height: "52px" },
    () => {
      input2.touch.yaw = 1;
    },
    () => {
      input2.touch.yaw = 0;
    }
  );
  tapBtn("LOCK\nTGT", { right: "20px", bottom: "250px", width: "70px", height: "56px" }, () => input2.onTarget?.());
  tapBtn("BOMB", { right: "20px", bottom: "314px", width: "70px", height: "56px" }, () => input2.onBomb?.());
  tapBtn("VIEW", { right: "20px", bottom: "378px", width: "70px", height: "56px" }, () => input2.onView?.());
  const toggles = [
    { label: "S-FOIL", fn: () => input2.onSFoils?.() },
    { label: "ASSIST", fn: () => input2.onFlightAssist?.() },
    { label: "GEAR", fn: () => input2.onGear?.() },
    { label: "VTOL", fn: () => input2.onVtol?.() },
    { label: "AUTO", fn: () => input2.onAutoLock?.() }
  ];
  toggles.forEach((t, i) => {
    const b = el("div", { ...BTN_BASE, pointerEvents: "auto", right: "20px", top: `${70 + i * 54}px`, width: "78px", height: "44px", borderColor: "#5dff7a", color: "#5dff7a" }, t.label);
    b.addEventListener("pointerdown", (e) => {
      b.style.background = "rgba(93,255,122,0.3)";
      t.fn();
      e.preventDefault();
    });
    b.addEventListener("pointerup", () => {
      b.style.background = "rgba(20,28,36,0.55)";
    });
    root.appendChild(b);
  });
}

// src/web/main.ts
function showError(label, e) {
  console.error(label, e);
  const s = document.getElementById("splash");
  const msg = e && e.stack || String(e);
  if (s) {
    s.style.display = "flex";
    s.innerHTML = `<h1 style="color:#ff5544;font-size:22px">\u26A0 ${label}</h1><pre style="color:#ffd24a;max-width:90vw;white-space:pre-wrap;font-size:12px;text-align:left">${msg}</pre>`;
  }
}
window.addEventListener("error", (ev) => showError("Runtime error", ev.error ?? ev.message));
window.addEventListener("unhandledrejection", (ev) => showError("Promise error", ev.reason));
var glCanvas = document.getElementById("gl");
var hudCanvas = document.getElementById("hud");
var scene = new Scene3D(glCanvas);
var hud = new HUD(hudCanvas);
var audio = new AudioEngine();
var input = new InputManager();
input.attach();
input.onFirstGesture = () => audio.start();
input.onBomb = () => scene.launchBomb();
input.onTarget = () => scene.cycleTarget();
input.onSFoils = () => scene.toggleSFoils();
input.onView = () => scene.toggleView();
input.onFlightAssist = () => scene.toggleFlightAssist();
input.onGear = () => scene.toggleGear();
input.onVtol = () => scene.toggleVtol();
input.onAutoLock = () => scene.toggleAutoLock();
try {
  setupMobileControls(input);
} catch (e) {
  console.warn("mobile controls init failed", e);
}
scene.onPlayerFire = () => audio.laser();
scene.onEnemyFire = () => audio.enemyLaser();
scene.onExplosion = () => audio.explosion();
scene.onTorpedo = () => audio.torpedo();
scene.onLock = () => audio.lockTone();
scene.onCockpitClick = () => audio.click();
var net = new Net();
net.onState = (id, s) => scene.upsertRemote(id, s);
net.onFire = (_id, f) => scene.spawnNetBolt(f);
net.onLeave = (id) => scene.removeRemote(id);
scene.onFire = (o, d, v) => net.sendFire({ o, d, v });
try {
  net.connect(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
} catch (e) {
  console.warn("net connect failed", e);
}
var lastNetSend = 0;
var dragging = false;
var moved = false;
var downX = 0;
var downY = 0;
var lastX = 0;
var lastY = 0;
glCanvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  moved = false;
  downX = lastX = e.clientX;
  downY = lastY = e.clientY;
});
window.addEventListener("pointermove", (e) => {
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) moved = true;
    if (moved) scene.adjustLook(-dy * 5e-3, -dx * 5e-3);
  } else {
    const over = scene.updateHover(e.clientX, e.clientY);
    glCanvas.style.cursor = over ? "pointer" : "default";
  }
});
window.addEventListener("pointerup", (e) => {
  if (dragging && !moved) scene.handleClick(e.clientX, e.clientY);
  dragging = false;
});
var lastHitWarn = 0;
scene.onPlayerHit = () => {
  const now = performance.now();
  if (now - lastHitWarn > 250) {
    audio.warning();
    lastHitWarn = now;
  }
};
var SIM_DT = 1 / 120;
var acc = 0;
var last = performance.now();
var lastLaser = 0;
var lastSearchBeep = 0;
var frameErrShown = false;
function frame(now) {
  try {
    const wall = Math.min(0.1, (now - last) / 1e3);
    last = now;
    const controls = input.sample(wall);
    acc += wall;
    while (acc >= SIM_DT) {
      scene.update(controls, SIM_DT);
      acc -= SIM_DT;
    }
    if (input.gunHeld && now - lastLaser > 95) {
      scene.firePrimary();
      lastLaser = now;
    }
    if (net.connected && now - lastNetSend > 50) {
      net.sendState(scene.getNetState());
      lastNetSend = now;
    }
    scene.render();
    const h = scene.getHud();
    hud.draw(h);
    audio.update(h.throttle * 100, h.throttle, 0);
    if (h.lock?.state === "searching" && h.lock.progress > 0 && now - lastSearchBeep > 300) {
      audio.lockSearch();
      lastSearchBeep = now;
    }
  } catch (e) {
    if (!frameErrShown) {
      frameErrShown = true;
      showError("Frame error", e);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__scene = scene;
window.__hud = () => scene.getHud();
