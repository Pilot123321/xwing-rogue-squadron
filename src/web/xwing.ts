/**
 * Procedurally-modeled Incom T-65B X-wing starfighter, shaped to read like the
 * film: a long slender fuselage with a sharp nose, a framed bubble canopy a
 * third of the way back, an R2 astromech socket behind it, four big Incom 4L4
 * engines at the wing roots (recessed intakes up front, glowing turbine
 * exhausts at the rear), and four S-foils that split into the attack "X" — each
 * wingtip carrying a long forward-pointing Taim & Bak KX9 laser cannon with a
 * red emitter tip. Weathered grey-white hull with Red Squadron markings. No
 * external assets; all primitive geometry.
 *
 * Nose points along -Z (Three's natural camera facing), so "forward" for the
 * flight model is (0,0,-1). Engines/exhaust face +Z.
 */

import * as THREE from "three";

export interface XWing {
  group: THREE.Group;
  setSFoils(open: number): void; // 0 = folded flat, 1 = full attack X
  setThrottle(t: number): void; // 0..1 engine-glow brightness
  setGear(down: boolean): void; // show/hide retractable landing gear
  cannonTips: THREE.Vector3[]; // model-space muzzle points (4 wingtip cannons)
}

const HULL = new THREE.MeshStandardMaterial({ color: 0xd7d8d1, metalness: 0.2, roughness: 0.62 });
const HULL2 = new THREE.MeshStandardMaterial({ color: 0xc3c5bd, metalness: 0.25, roughness: 0.7 });
const PANEL = new THREE.MeshStandardMaterial({ color: 0xcdcfc7, metalness: 0.25, roughness: 0.65, side: THREE.DoubleSide });
const DARK = new THREE.MeshStandardMaterial({ color: 0x33373d, metalness: 0.55, roughness: 0.45 });
const GREEBLE = new THREE.MeshStandardMaterial({ color: 0x52565d, metalness: 0.6, roughness: 0.5 });
const METAL = new THREE.MeshStandardMaterial({ color: 0x70757d, metalness: 0.75, roughness: 0.32 });
const RED = new THREE.MeshStandardMaterial({ color: 0xb23528, metalness: 0.15, roughness: 0.7 });
const GLASS = new THREE.MeshStandardMaterial({ color: 0x0a161e, metalness: 0.65, roughness: 0.12 });
const TURBINE = new THREE.MeshStandardMaterial({ color: 0x101216, metalness: 0.7, roughness: 0.35 });

/** A recessed, glowing turbine exhaust (returns the glow mesh for throttle). */
function buildExhaust(): { group: THREE.Group; glow: THREE.Mesh } {
  const g = new THREE.Group();
  // dark recessed throat
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 1.0, 28, 1, true), TURBINE);
  throat.rotation.x = Math.PI / 2;
  throat.position.z = -0.4;
  g.add(throat);
  // turbine face (dark disc) + radial blades
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.46, 32), TURBINE);
  face.position.z = -0.85; face.rotation.y = Math.PI;
  g.add(face);
  for (let i = 0; i < 9; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.04), GREEBLE);
    blade.position.set(0, 0, -0.82);
    blade.rotation.z = (i / 9) * Math.PI * 2;
    blade.position.x = Math.cos(blade.rotation.z) * 0.2;
    blade.position.y = Math.sin(blade.rotation.z) * 0.2;
    g.add(blade);
  }
  const hub = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 16), METAL);
  hub.rotation.x = -Math.PI / 2; hub.position.z = -0.7;
  g.add(hub);
  // glowing ring around the throat (HDR so it blooms)
  const glow = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.09, 14, 36),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.9, 0.3), transparent: true, opacity: 0.9, toneMapped: false }));
  glow.position.z = 0.05;
  g.add(glow);
  // inner glow disc
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.34, 28),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.2, 0.6), transparent: true, opacity: 0.45, toneMapped: false }));
  core.position.z = -0.3; core.rotation.y = Math.PI;
  g.add(core);
  glow.userData.core = core;
  return { group: g, glow };
}

export function buildXWing(): XWing {
  const group = new THREE.Group();

  // ---------------------------------------------------------------- fuselage
  // The T-65 hull is wider than it is tall and flat-bottomed (not a tube), so we
  // flatten the cross-section (scale.z) and widen it (scale.x).
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.9, 12.5, 28), HULL);
  body.rotation.x = Math.PI / 2;
  body.scale.set(1.18, 1, 0.72);
  body.position.set(0, -0.05, 1.0);
  group.add(body);
  // dorsal spine + ventral keel for the angular silhouette
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, 9), HULL2);
  spine.position.set(0, 0.5, 1.5);
  group.add(spine);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.42, 8), HULL2);
  keel.position.set(0, -0.62, 0.5);
  group.add(keel);

  // Long pointed nose — flattened into a wedge and drooped down the iconic slope.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.58, 7.6, 28), HULL);
  nose.rotation.x = -Math.PI / 2 - 0.05; // slight downward droop
  nose.scale.set(1.18, 1, 0.6); // wide + flat wedge
  nose.position.set(0, -0.18, -8.6);
  group.add(nose);
  // flat chamfered underside of the nose (the slab belly slope)
  const noseBelly = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 6.5), GREEBLE);
  noseBelly.position.set(0, -0.62, -7.6);
  noseBelly.rotation.x = 0.06;
  group.add(noseBelly);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.1, 2.4, 16), DARK);
  tip.rotation.x = Math.PI / 2 + 0.05;
  tip.position.set(0, -0.42, -13.0);
  group.add(tip);

  // --- markings: long red stripe down each side of the fuselage + nose bands ---
  for (const sx of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 11), RED);
    stripe.position.set(sx * 0.78, -0.1, 0.8);
    group.add(stripe);
  }
  for (const z of [-9.6, -7.9]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.62, 0.5, 24), RED);
    band.rotation.x = Math.PI / 2; band.scale.set(1.18, 1, 0.6); // match the wedge nose
    band.position.set(0, -0.18, z);
    group.add(band);
  }
  // panel-line / greeble detailing
  for (const z of [-5, -3, -0.5, 2.5, 4.5]) {
    const pl = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.5), GREEBLE);
    pl.position.set(0, 0.78, z);
    group.add(pl);
  }
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 7), GREEBLE);
  belly.position.set(0, -0.85, -4.5);
  group.add(belly);

  // ---------------------------------------------------------------- cockpit
  // Raised cockpit "saddle" that steps up from the sloped nose, with a raked
  // windscreen and a long tapered bubble canopy (movie profile).
  const fairing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 3.4), HULL);
  fairing.position.set(0, 0.5, -1.6);
  group.add(fairing);
  // raked windscreen at the front of the canopy
  const windscreen = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.7, 0.1), GLASS);
  windscreen.position.set(0, 0.78, -3.05);
  windscreen.rotation.x = 0.6; // steeply raked
  group.add(windscreen);
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), GLASS);
  canopy.scale.set(0.86, 0.74, 2.0);
  canopy.position.set(0, 0.84, -1.7);
  group.add(canopy);
  // canopy frame: longitudinal rails + cross ribs
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 3.5), METAL);
    rail.position.set(sx * 0.4, 0.92, -1.7);
    group.add(rail);
  }
  for (const z of [-3.0, -1.8, -0.6]) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 12, 28, Math.PI), METAL);
    rib.rotation.y = Math.PI / 2; rib.position.set(0, 0.84, z);
    rib.scale.set(1.42, 1.18, 1);
    group.add(rib);
  }

  // ---------------------------------------------------------------- R2 unit
  const r2body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.6, 24), HULL2);
  r2body.position.set(0, 0.78, 0.7); group.add(r2body);
  const r2dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf2f2ee, metalness: 0.3, roughness: 0.4 }));
  r2dome.position.set(0, 1.08, 0.7); group.add(r2dome);
  const r2blue = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x2266aa, emissive: 0x113a66, roughness: 0.4 }));
  r2blue.position.set(0, 1.16, 0.46); group.add(r2blue);

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.7, 1.8, 24), DARK);
  tail.rotation.x = Math.PI / 2; tail.position.z = 7.2; group.add(tail);

  // ----------------------------------------------------- S-foils + engines
  const pivots: { pivot: THREE.Group; sign: number; rootX: number; rootY: number }[] = [];
  const engineGlows: THREE.Mesh[] = [];
  const cannonTips: THREE.Vector3[] = [];

  const wings: [number, number, number][] = [
    [-1.5, 0.95, 1],   // upper-left
    [1.5, 0.95, -1],   // upper-right
    [-1.5, -0.95, -1], // lower-left
    [1.5, -0.95, 1],   // lower-right
  ];

  for (const [rootX, rootY, sign] of wings) {
    const out = Math.sign(rootX);
    const pivot = new THREE.Group();
    pivot.position.set(rootX, rootY, 2.4);

    // tapered wing panel
    const wing = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.13, 2.7), PANEL);
    wing.position.set(out * 3.9, 0, 0.4); pivot.add(wing);
    const lead = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.13, 0.5), GREEBLE);
    lead.position.set(out * 3.9, 0, -0.98); pivot.add(lead);
    // red wing stripes (root + tip), like Red Squadron panels
    const tipStripe = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.15, 2.7), RED);
    tipStripe.position.set(out * 6.4, 0, 0.4); pivot.add(tipStripe);
    const rootStripe = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.15, 2.7), RED);
    rootStripe.position.set(out * 1.6, 0, 0.4); pivot.add(rootStripe);

    // Wing-root fairing: bridges the fuselage out to the engine so there's no
    // gap between the body and the nacelle. Spans from the hull side (inboard)
    // to the engine, and tilts with the S-foil when it opens.
    const fairing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 3.0), HULL);
    fairing.position.set(out * -0.35, 0, 1.0); pivot.add(fairing);

    // big Incom 4L4 engine nacelle
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.6, 5.0, 28), METAL);
    nacelle.rotation.x = Math.PI / 2; nacelle.position.set(out * 0.6, 0, 1.7); pivot.add(nacelle);
    // red band around the engine
    const eband = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.5, 28), RED);
    eband.rotation.x = Math.PI / 2; eband.position.set(out * 0.6, 0, 0.3); pivot.add(eband);
    // recessed front intake
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.5, 0.4, 28), DARK);
    lip.rotation.x = Math.PI / 2; lip.position.set(out * 0.6, 0, -0.85); pivot.add(lip);
    const intake = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.0, 28, 1, true), TURBINE);
    intake.rotation.x = -Math.PI / 2; intake.position.set(out * 0.6, 0, -0.7); pivot.add(intake);
    // glowing turbine exhaust at the rear
    const ex = buildExhaust();
    ex.group.position.set(out * 0.6, 0, 4.2);
    pivot.add(ex.group);
    engineGlows.push(ex.glow);

    // long wingtip laser cannon (Taim & Bak KX9)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 9.5, 24), DARK);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(out * 6.7, 0, -2.0); pivot.add(barrel);
    for (const cz of [-4.4, 0.4]) { // collars
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 20), METAL);
      collar.rotation.x = Math.PI / 2; collar.position.set(out * 6.7, 0, cz); pivot.add(collar);
    }
    const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, 1.1, 16), RED);
    emitter.rotation.x = Math.PI / 2; emitter.position.set(out * 6.7, 0, -6.9); pivot.add(emitter);

    group.add(pivot);
    pivots.push({ pivot, sign, rootX, rootY });
    cannonTips.push(new THREE.Vector3());
  }

  const TIP_LOCAL_X = 6.7;
  const TIP_LOCAL_Z = -7.4;
  const PIVOT_Z = 2.4;

  // ----------------------------------------------------- retractable landing gear
  const gear = new THREE.Group();
  const strut = (x: number, z: number) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.7, 10), METAL);
    leg.position.set(x, -1.45, z);
    gear.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.22, 16), DARK);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, -2.3, z);
    gear.add(wheel);
  };
  strut(0, -6.5);   // nose gear
  strut(-1.4, 1.2); // left main
  strut(1.4, 1.2);  // right main
  gear.visible = false;
  group.add(gear);

  const xwing: XWing = {
    group,
    cannonTips,
    setGear(down: boolean) { gear.visible = down; },
    setSFoils(open: number) {
      const spread = open * 0.5;
      for (let i = 0; i < pivots.length; i++) {
        const { pivot, sign, rootX, rootY } = pivots[i];
        pivot.rotation.z = sign * spread;
        const out = Math.sign(rootX);
        const v = new THREE.Vector3(out * TIP_LOCAL_X, 0, TIP_LOCAL_Z);
        v.applyEuler(new THREE.Euler(0, 0, sign * spread));
        v.add(new THREE.Vector3(rootX, rootY, PIVOT_Z));
        cannonTips[i].copy(v);
      }
    },
    setThrottle(t: number) {
      for (const g of engineGlows) {
        const m = g.material as THREE.MeshBasicMaterial;
        m.opacity = 0.45 + t * 0.55;
        g.scale.setScalar(0.85 + t * 0.4);
        const core = g.userData.core as THREE.Mesh | undefined;
        if (core) (core.material as THREE.MeshBasicMaterial).opacity = 0.3 + t * 0.6;
      }
    },
  };
  xwing.setSFoils(1);
  return xwing;
}
