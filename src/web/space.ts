/**
 * The space backdrop: a dome of stars, a planet below, a distant Death Star, and
 * an Imperial Star Destroyer the player can fly around. All procedural. World
 * units are arbitrary "meters"; the X-wing is ~22 long.
 */

import * as THREE from "three";
import { DS_CENTER, DS_Y } from "./surface.ts";

export interface Space {
  group: THREE.Group;
  /** Large background objects don't move; nothing to update, but kept for symmetry. */
  update(dt: number, t: number): void;
}

export function buildSpace(): Space {
  const group = new THREE.Group();

  // --- Starfield: points on a big sphere shell ---
  const STARS = 3500;
  const pos = new Float32Array(STARS * 3);
  const col = new Float32Array(STARS * 3);
  for (let i = 0; i < STARS; i++) {
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    const r = 90000 + Math.random() * 10000;
    pos[i * 3] = dir.x * r;
    pos[i * 3 + 1] = dir.y * r;
    pos[i * 3 + 2] = dir.z * r;
    const tint = Math.random();
    const c = new THREE.Color().setHSL(0.55 + tint * 0.1, 0.2, 0.7 + Math.random() * 0.3);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  sg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 220, vertexColors: true, sizeAttenuation: true }));
  stars.frustumCulled = false;
  group.add(stars);

  // (Blue backdrop planet removed.)

  // --- Death Star: a real sphere sitting UNDER the landable trench, so the
  // trench corridor reads as being cut into the Death Star's surface. ---
  const ds = new THREE.Group();
  const dsR = 13000;
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(dsR, 64, 48),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a8, emissive: 0x101214, roughness: 0.85, metalness: 0.15 }),
  );
  ds.add(sphere);
  // superlaser dish (recessed northern cap).
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2.4),
    new THREE.MeshStandardMaterial({ color: 0x70757c, roughness: 0.8 }),
  );
  dish.position.set(-4200, dsR * 0.62, -6000);
  dish.rotation.x = Math.PI;
  ds.add(dish);

  // One clean EQUATORIAL trench groove around the middle, splitting the sphere
  // into two hemispheres (the iconic Death Star trench line).
  const trenchMat = new THREE.MeshStandardMaterial({ color: 0x2c2f34, metalness: 0.5, roughness: 0.75 });
  const trench = new THREE.Mesh(new THREE.TorusGeometry(dsR, 360, 20, 260), trenchMat);
  trench.rotation.x = Math.PI / 2; // horizontal — wraps the equator
  ds.add(trench);
  // Thin bright seam line in the groove so it reads as a recessed channel.
  const seam = new THREE.Mesh(new THREE.TorusGeometry(dsR + 8, 60, 8, 260),
    new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.6, roughness: 0.6 }));
  seam.rotation.x = Math.PI / 2;
  ds.add(seam);
  // Centre it so its top is just beneath the trench plateau (DS_Y), at the
  // landable Death Star location — the trench slab now lies on the sphere.
  ds.position.set(DS_CENTER.x, DS_Y - dsR + 60, DS_CENTER.y);
  group.add(ds);

  // --- Imperial Star Destroyer: long grey wedge ---
  const isd = buildStarDestroyer();
  isd.position.set(0, -1200, -9000);
  isd.rotation.y = Math.PI;
  group.add(isd);

  return {
    group,
    update() {/* static backdrop */},
  };
}

function buildStarDestroyer(): THREE.Group {
  const g = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.3, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x55595f, metalness: 0.4, roughness: 0.6 });

  // Main dagger hull: an extruded triangle. Approximate with a scaled cone (3-sided).
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 1, 1, 3), grey);
  hull.scale.set(1600, 1, 4800);
  hull.rotation.x = Math.PI / 2;
  hull.rotation.z = Math.PI / 2;
  // flatten vertically
  hull.scale.y = 220;
  g.add(hull);

  // Raised superstructure tower near the back.
  const tower = new THREE.Mesh(new THREE.BoxGeometry(360, 160, 600), dark);
  tower.position.set(0, 180, 1700);
  g.add(tower);
  // Two command bridge "golf balls".
  for (const sx of [-90, 90]) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(55, 28, 18), dark);
    ball.position.set(sx, 300, 1750);
    g.add(ball);
  }
  // surface detail strips
  for (let i = 0; i < 6; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 3000), dark);
    strip.position.set(-500 + i * 200, 115, 0);
    g.add(strip);
  }
  return g;
}
