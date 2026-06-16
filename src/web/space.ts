/**
 * The space backdrop: a dome of stars, a planet below, a distant Death Star, and
 * an Imperial Star Destroyer the player can fly around. All procedural. World
 * units are arbitrary "meters"; the X-wing is ~22 long.
 */

import * as THREE from "three";
import { DS_SPHERE_R, DS_SPHERE_CENTER, DS_TRENCH_W, DS_TRENCH_DEPTH } from "./surface.ts";

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

  // --- Distant sun: a bright far-away star along the directional-light vector,
  // so the lighting on the ships reads as coming from this sun. ---
  const sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
  const sunPos = sunDir.multiplyScalar(78000);
  const sun = new THREE.Group();
  // bright core
  sun.add(new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 7.4, 6), toneMapped: false })));
  // soft additive halo
  sun.add(new THREE.Mesh(new THREE.SphereGeometry(8200, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })));
  sun.add(new THREE.Mesh(new THREE.SphereGeometry(14000, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false })));
  sun.position.copy(sunPos);
  group.add(sun);

  // (Blue backdrop planet removed.)

  // --- Death Star: a solid grey sphere with an equatorial trench groove. ---
  const ds = new THREE.Group();
  const dsR = DS_SPHERE_R;
  // Matte grey (no emissive) so the sun lights it instead of it glowing white.
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(dsR, 96, 72),
    new THREE.MeshStandardMaterial({ color: 0x8b9097, roughness: 0.95, metalness: 0.1 }),
  );
  ds.add(sphere);

  // Surface greebles: scattered panel boxes + a few craters, so it isn't a
  // featureless ball.
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x7d828a, roughness: 0.9, metalness: 0.12 });
  const craterMat = new THREE.MeshStandardMaterial({ color: 0x6f747b, roughness: 1.0, metalness: 0.08 });
  for (let i = 0; i < 260; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.acos(2 * Math.random() - 1);
    const dir = new THREE.Vector3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
    if (Math.abs(dir.y) < 0.08) continue; // keep the equatorial trench band clear
    const sz = 200 + Math.random() * 500;
    const greeb = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * (0.5 + Math.random()), 60 + Math.random() * 80), panelMat);
    greeb.position.copy(dir).multiplyScalar(dsR - 20);
    greeb.lookAt(0, 0, 0);
    ds.add(greeb);
  }
  // superlaser dish (recessed northern crater).
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(3200, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2.3), craterMat);
  dish.position.set(-4600, dsR * 0.58, -6400);
  dish.rotation.x = Math.PI;
  ds.add(dish);

  // Equatorial TRENCH: a recessed channel — a dark sunken floor torus flanked by
  // two raised rim ribs, so it reads as a real cut, not a painted line.
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x202327, roughness: 0.85, metalness: 0.2 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x6b7077, roughness: 0.9, metalness: 0.15 });
  const floor = new THREE.Mesh(new THREE.TorusGeometry(dsR - DS_TRENCH_DEPTH, DS_TRENCH_W, 16, 320), floorMat);
  floor.rotation.x = Math.PI / 2;
  ds.add(floor);
  const edgeLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.2), toneMapped: false });
  for (const side of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(dsR - 80, 180, 14, 320), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = side * (DS_TRENCH_W + 130);
    ds.add(rim);
    // Bright running-light strip along each trench edge so the trench is visible.
    const strip = new THREE.Mesh(new THREE.TorusGeometry(dsR - 40, 30, 8, 360), edgeLight);
    strip.rotation.x = Math.PI / 2;
    strip.position.y = side * (DS_TRENCH_W + 20);
    ds.add(strip);
  }
  // greeble ribs along the trench walls
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(120, DS_TRENCH_W * 2, 220), floorMat);
    rib.position.set(Math.cos(a) * (dsR - DS_TRENCH_DEPTH * 0.4), 0, Math.sin(a) * (dsR - DS_TRENCH_DEPTH * 0.4));
    rib.rotation.y = -a;
    ds.add(rib);
  }

  ds.position.copy(DS_SPHERE_CENTER);
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
