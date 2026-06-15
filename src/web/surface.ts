/**
 * Landable battlefields below the space arena: a procedurally sculpted PLANET
 * surface with a Rebel base you can set down on and repair at, and a DEATH STAR
 * surface slab with a deep equatorial trench. Both share one heightAt(x,z) field
 * so the player can fly down, skim the geography, land, and fight on the deck.
 *
 * Zones are placed in world XZ: the planet under the origin (where the dogfight
 * happens), the Death Star off to the +X side. Outside both zones heightAt
 * returns -Infinity (open space — no ground).
 */

import * as THREE from "three";

export const PLANET_CENTER = new THREE.Vector2(0, 0);
export const PLANET_RADIUS = 15500;
export const PLANET_Y = -2600;

export const DS_CENTER = new THREE.Vector2(52000, 0);
export const DS_RADIUS = 11000;
export const DS_Y = -2600;

/** Rebel base centre (on the flattened planet apron). */
export const BASE_POS = new THREE.Vector3(0, PLANET_Y, 2600);

/** The Death Star thermal exhaust port — the trench-run bombing target. */
export const EXHAUST_PORT = new THREE.Vector3(DS_CENTER.x + 7000, DS_Y - 1440, DS_CENTER.y);

export interface Surface {
  group: THREE.Group;
  heightAt(x: number, z: number): number;
  /** Landing pads (world positions); landing near one repairs the ship. */
  pads: THREE.Vector3[];
  /** Solid obstacle volumes the player crashes into (walls, buildings). */
  obstacles: THREE.Box3[];
}

function planetFbm(x: number, z: number): number {
  return Math.sin(x * 0.00045) * Math.cos(z * 0.00052) * 1.0
    + Math.sin(x * 0.0013 + 1.3) * Math.cos(z * 0.0011 + 0.7) * 0.45
    + Math.sin(x * 0.0031 + 2.1) * Math.cos(z * 0.0027 + 2.3) * 0.2;
}

// The planet is a real sphere. Its centre sits well below the play area so the
// top cap is where you fly/land; heightAt returns the sphere-cap surface, which
// is a proper round dome (no flared skirt).
export const PLANET_R = 9000;
export const PLANET_CY = PLANET_Y - PLANET_R; // centre, so the top is at PLANET_Y
function planetHeight(x: number, z: number): number {
  const d = Math.hypot(x - PLANET_CENTER.x, z - PLANET_CENTER.y);
  if (d >= PLANET_R) return PLANET_CY; // past the visible cap — flat low (rarely reached)
  let h = PLANET_CY + Math.sqrt(PLANET_R * PLANET_R - d * d) + planetFbm(x, z) * 90;
  // Flatten an apron around the base.
  const bd = Math.hypot(x - BASE_POS.x, z - BASE_POS.z);
  const apron = PLANET_CY + Math.sqrt(PLANET_R * PLANET_R - (BASE_POS.x * BASE_POS.x + BASE_POS.z * BASE_POS.z));
  if (bd < 1500) h = THREE.MathUtils.lerp(apron, h, Math.min(1, bd / 1500));
  return h;
}

// Death Star surface: a high armoured plateau split by a deep equatorial TRENCH
// running along +X (lz ~ 0). The trench is the bombing run corridor.
export const DS_TRENCH_HALF = 420; // trench half-width (z)
export const DS_TRENCH_FLOOR = DS_Y - 1500;
function dsHeight(lx: number, lz: number): number {
  // greebled plateau top
  let h = DS_Y + (Math.sin(lx * 0.004) * Math.cos(lz * 0.004)) * 90
    + (Math.sin(lx * 0.02) * Math.sin(lz * 0.018)) * 40;
  const a = Math.abs(lz);
  if (a < DS_TRENCH_HALF) h = DS_TRENCH_FLOOR; // deep trench floor
  else if (a < DS_TRENCH_HALF + 160) h = THREE.MathUtils.lerp(DS_TRENCH_FLOOR, h, (a - DS_TRENCH_HALF) / 160);
  return h;
}

function heightAt(x: number, z: number): number {
  if (Math.hypot(x - PLANET_CENTER.x, z - PLANET_CENTER.y) < PLANET_RADIUS) {
    return planetHeight(x, z);
  }
  const lx = x - DS_CENTER.x, lz = z - DS_CENTER.y;
  if (Math.hypot(lx, lz) < DS_RADIUS) return dsHeight(lx, lz);
  return -Infinity;
}

/** Displace a flat grid into a terrain mesh using fn, with height-based colour. */
function terrainMesh(
  size: number, segs: number, cx: number, cz: number,
  fn: (x: number, z: number) => number,
  lo: THREE.Color, hi: THREE.Color, baseY: number,
  material: THREE.Material,
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
    const y = fn(x, z);
    pos.setY(i, y);
    const t = THREE.MathUtils.clamp((y - baseY) / 1300 + 0.5, 0, 1);
    c.copy(lo).lerp(hi, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(cx, 0, cz);
  return mesh;
}

export function buildSurface(): Surface {
  const group = new THREE.Group();
  const pads: THREE.Vector3[] = [];
  const obstacles: THREE.Box3[] = [];
  const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) =>
    obstacles.push(new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(cx, cy, cz), new THREE.Vector3(sx, sy, sz)));

  // --- Planet: a real sphere (top cap is the landable area) ---
  const planetGeo = new THREE.SphereGeometry(PLANET_R, 96, 64);
  {
    const p = planetGeo.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    const lo = new THREE.Color(0x2c3d22), hi = new THREE.Color(0x6f6444), v = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i));
      const n = planetFbm(v.x * 6 + PLANET_CENTER.x, v.z * 6 + PLANET_CENTER.y);
      v.multiplyScalar(1 + n * 0.012); // gentle surface relief
      p.setXYZ(i, v.x, v.y, v.z);
      c.copy(lo).lerp(hi, THREE.MathUtils.clamp(0.5 + n * 0.5, 0, 1));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    planetGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    planetGeo.computeVertexNormals();
  }
  const planet = new THREE.Mesh(planetGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.0 }));
  planet.position.set(PLANET_CENTER.x, PLANET_CY, PLANET_CENTER.y);
  group.add(planet);
  // Apron height where the base sits (top of the cap near the base location).
  const apronY = PLANET_CY + Math.sqrt(PLANET_R * PLANET_R - (BASE_POS.x * BASE_POS.x + BASE_POS.z * BASE_POS.z));

  // --- Rebel base: landing pads + hangar + control tower + shield dome ---
  const baseMetal = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.5, roughness: 0.5 });
  const baseDark = new THREE.MeshStandardMaterial({ color: 0x44484e, metalness: 0.6, roughness: 0.5 });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.4, roughness: 0.7 });
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.4, 1.0), toneMapped: false });

  for (let p = 0; p < 2; p++) {
    const px = BASE_POS.x + (p === 0 ? -700 : 700);
    const pz = BASE_POS.z;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(420, 440, 24, 32), padMat);
    pad.position.set(px, apronY + 12, pz);
    group.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(380, 16, 14, 56), lightMat);
    ring.rotation.x = Math.PI / 2; ring.position.set(px, apronY + 26, pz);
    group.add(ring);
    // approach lights
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 12), lightMat);
      l.position.set(px + Math.cos(a) * 380, apronY + 30, pz + Math.sin(a) * 380);
      group.add(l);
    }
    pads.push(new THREE.Vector3(px, apronY + 24, pz));
  }

  // hangar
  const hangar = new THREE.Mesh(new THREE.BoxGeometry(1200, 360, 800), baseMetal);
  hangar.position.set(BASE_POS.x, apronY + 180, BASE_POS.z - 1200);
  group.add(hangar);
  box(BASE_POS.x, apronY + 180, BASE_POS.z - 1200, 1200, 360, 800);
  const hangarDoor = new THREE.Mesh(new THREE.BoxGeometry(700, 280, 30), baseDark);
  hangarDoor.position.set(BASE_POS.x, apronY + 140, BASE_POS.z - 800);
  group.add(hangarDoor);
  // control tower
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(90, 130, 700, 24), baseMetal);
  tower.position.set(BASE_POS.x + 1400, apronY + 350, BASE_POS.z - 400);
  group.add(tower);
  box(BASE_POS.x + 1400, apronY + 350, BASE_POS.z - 400, 260, 700, 260);
  const towerTop = new THREE.Mesh(new THREE.CylinderGeometry(220, 180, 160, 24), baseDark);
  towerTop.position.set(BASE_POS.x + 1400, apronY + 760, BASE_POS.z - 400);
  group.add(towerTop);
  // shield generator dome
  const dome = new THREE.Mesh(new THREE.SphereGeometry(360, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), baseDark);
  dome.position.set(BASE_POS.x - 1600, apronY, BASE_POS.z - 200);
  group.add(dome);

  // NOTE: the Death Star body + its equatorial trench are now the clean sphere
  // built in space.ts. The old flaring flat-slab plateau, trench walls and
  // greebles were removed (they stuck out and looked wrong). heightAt still
  // provides a landing/collision surface there if approached.

  return { group, heightAt, pads, obstacles };
}
