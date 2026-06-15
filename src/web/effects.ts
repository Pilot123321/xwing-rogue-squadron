/**
 * Visual effects: explosions (fireball + debris particles + flash) and small
 * ground-impact puffs. Pure procedural geometry/particles, no assets. All sizes
 * are in feet to match the world.
 */

import * as THREE from "three";

interface Explosion {
  group: THREE.Group;
  fire: THREE.Mesh;
  particles: THREE.Points;
  velocities: Float32Array;
  light: THREE.PointLight;
  t: number;
  dur: number;
}

interface Debris {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  t: number;
  dur: number;
}

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  t: number;
  dur: number;
}

export class Effects {
  private explosions: Explosion[] = [];
  private debris: Debris[] = [];
  private puffs: Puff[] = [];

  constructor(private root: THREE.Object3D) {}

  /** Tumbling wreckage chunks flung from a destroyed ship (no gravity in space). */
  spawnDebris(pos: THREE.Vector3, baseVel: THREE.Vector3, n = 12, scale = 1): void {
    for (let i = 0; i < n; i++) {
      const s = (0.6 + Math.random() * 1.6) * scale;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(s, s * (0.3 + Math.random() * 0.7), s * (0.4 + Math.random())),
        new THREE.MeshStandardMaterial({ color: 0x6a6e74, metalness: 0.6, roughness: 0.5, transparent: true, opacity: 1 }),
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
  spawnSmoke(pos: THREE.Vector3): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x33363a, transparent: true, opacity: 0.55 }),
    );
    mesh.position.copy(pos);
    this.root.add(mesh);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8);
    this.puffs.push({ mesh, vel, t: 0, dur: 1.1 + Math.random() * 0.5 });
  }

  /** Big explosion (aircraft/missile/bomb impact). scale ~1 small, ~3 large. */
  spawnExplosion(pos: THREE.Vector3, scale = 1): void {
    const group = new THREE.Group();
    group.position.copy(pos);

    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(1, 28, 18),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 2.2, 0.9), transparent: true, opacity: 1, toneMapped: false }),
    );
    group.add(fire);

    // Debris particles.
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
    const particles = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: 0xff8030, size: 4, sizeAttenuation: true, transparent: true }));
    group.add(particles);

    const light = new THREE.PointLight(0xffa040, 8, 4000 * scale);
    group.add(light);

    this.root.add(group);
    this.explosions.push({ group, fire, particles, velocities, light, t: 0, dur: 1.6, });
    // scale the whole event
    group.userData.scale = scale;
  }

  /** Small dust/spark puff for bullet ground hits. */
  spawnImpact(pos: THREE.Vector3): void {
    this.spawnExplosion(pos, 0.4);
  }

  update(dt: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.t += dt;
      const k = e.t / e.dur; // 0..1
      const scale = e.group.userData.scale ?? 1;

      // Fireball expands then fades.
      const r = (5 + 20 * Math.min(1, k * 2)) * scale;
      e.fire.scale.setScalar(r);
      (e.fire.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k * 1.3);
      (e.fire.material as THREE.MeshBasicMaterial).color.setRGB(
        ...(k < 0.3 ? [3.8, 3.0, 1.6] : [2.8, 0.8, 0.25]) as [number, number, number]);

      // Particles fly out under gravity.
      const pos = e.particles.geometry.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < pos.count; j++) {
        e.velocities[j * 3 + 1] -= 32.17 * dt; // gravity
        pos.setX(j, pos.getX(j) + e.velocities[j * 3] * dt);
        pos.setY(j, pos.getY(j) + e.velocities[j * 3 + 1] * dt);
        pos.setZ(j, pos.getZ(j) + e.velocities[j * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      (e.particles.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - k);

      e.light.intensity = Math.max(0, 8 * (1 - k * 1.5));

      if (e.t >= e.dur) {
        this.root.remove(e.group);
        e.fire.geometry.dispose();
        e.particles.geometry.dispose();
        this.explosions.splice(i, 1);
      }
    }

    // --- Debris chunks (drift + tumble, fade out) ---
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t += dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      const k = d.t / d.dur;
      if (k > 0.6) (d.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - (k - 0.6) / 0.4);
      if (d.t >= d.dur) {
        this.root.remove(d.mesh);
        d.mesh.geometry.dispose();
        this.debris.splice(i, 1);
      }
    }

    // --- Smoke puffs (expand + fade) ---
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.t += dt;
      const k = p.t / p.dur;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(2 + k * 10);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.55 * (1 - k));
      if (p.t >= p.dur) {
        this.root.remove(p.mesh);
        p.mesh.geometry.dispose();
        this.puffs.splice(i, 1);
      }
    }
  }
}
