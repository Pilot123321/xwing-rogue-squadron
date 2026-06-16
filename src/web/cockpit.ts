/**
 * First-person X-wing cockpit interior, built in ship-local space (nose toward
 * -Z, +Y up, pilot eye near the origin). Shown only in the cockpit view.
 *
 * It is a FULLY ENCLOSED tub: an opaque lower shell (floor, side consoles, front
 * console, rear bulkhead, seat) plus a transparent tinted canopy bubble overhead
 * and to the sides, with a metal frame. Because the exterior hull is hidden in
 * this view (and you can free-look 360°), the enclosure means every direction
 * shows solid structure or canopy glass — never a hole out to empty space.
 *
 * Returns the group plus the instrument bits the game animates (sensor scope,
 * bar gauges) and the clickable console buttons.
 */

import * as THREE from "three";

export interface Cockpit {
  group: THREE.Group;
  scopeCanvas: HTMLCanvasElement;
  scopeTex: THREE.CanvasTexture;
  setBars(hull: number, throttle: number): void;
  buttons: { id: string; mesh: THREE.Mesh }[];
  setIndicator(id: string, on: boolean): void;
  press(id: string): void;
  setHover(id: string | null): void;
  update(now: number): void;
  /** Throw the landing-gear lever to match gear state. */
  setGearLever(down: boolean): void;
  /** Rotate the VTOL rotary dial to OFF/ON. */
  setVtolDial(on: boolean): void;
  /** Left MFD screen — the game points the targeting-pod TV feed at this. */
  tvScreen: THREE.Mesh;
}

function makeLabel(text: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 48;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0c0f12"; ctx.fillRect(0, 0, 128, 48);
  ctx.fillStyle = "#cfe3ee"; ctx.font = "bold 20px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 24);
  return new THREE.CanvasTexture(c);
}

const SHELL = new THREE.MeshStandardMaterial({ color: 0x1a1d22, metalness: 0.35, roughness: 0.85 });
const FRAME = new THREE.MeshStandardMaterial({ color: 0x2a2e34, metalness: 0.55, roughness: 0.5 });
const PANEL = new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.3, roughness: 0.85 });
const TRIM = new THREE.MeshStandardMaterial({ color: 0x3c4046, metalness: 0.6, roughness: 0.4 });
const GLASS = new THREE.MeshStandardMaterial({
  color: 0x2b3d4f, transparent: true, opacity: 0.16, side: THREE.BackSide,
  roughness: 0.06, metalness: 0.0, depthWrite: false,
});

function litPanel(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.5 });
}

export function buildCockpit(): Cockpit {
  const group = new THREE.Group();

  // ---------------------------------------------------------- enclosure shell
  // Transparent canopy bubble around the pilot (you see stars through it).
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.7, 28, 20), GLASS);
  canopy.position.set(0, 0.75, -0.7);
  group.add(canopy);

  // Opaque lower tub so you never look down/out through the glass into void.
  // Widened so the consoles, sill, stick and dash all have clearance.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.14, 4.4), SHELL);
  floor.position.set(0, -0.52, -0.5);
  group.add(floor);
  // side consoles (tall enough to wall off the lower side view)
  for (const sx of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 4.4), SHELL);
    wall.position.set(sx * 1.3, 0.05, -0.5);
    wall.rotation.z = sx * 0.16;
    group.add(wall);
    // clean console top (no scattered LEDs)
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 3.0), FRAME);
    top.position.set(sx * 1.26, 0.42, -0.9);
    top.rotation.z = sx * 0.16;
    group.add(top);
  }
  // front lower wall (below the dashboard) + rear bulkhead
  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.0, 0.2), SHELL);
  frontWall.position.set(0, -0.25, -2.45);
  group.add(frontWall);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.9, 0.25), SHELL);
  rear.position.set(0, 0.4, 1.6);
  group.add(rear);
  const roofRear = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 1.2), SHELL);
  roofRear.position.set(0, 1.4, 1.2);
  group.add(roofRear);

  // ejection seat
  const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.7), TRIM);
  seatBase.position.set(0, -0.36, 0.35); group.add(seatBase);
  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.1, 0.18), TRIM);
  seatBack.position.set(0, 0.22, 0.7); group.add(seatBack);
  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.18), FRAME);
  headrest.position.set(0, 0.85, 0.72); group.add(headrest);

  // F-16-style frameless bubble canopy: NO bars across the view — just a thin
  // canopy sill ring around the rim (down low). The whole dome above is clear.
  const sill = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.05, 10, 44), FRAME);
  sill.position.set(0, -0.08, -0.6);
  sill.rotation.x = Math.PI / 2;
  sill.scale.set(1.0, 1.7, 1.0); // longer fore-aft than wide, like a cockpit rim
  group.add(sill);

  // ------------------------------------------------------------ instruments
  // (Glareshield hood removed — it was the big bar across the front view.)
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.3, 0.14), PANEL);
  panel.position.set(0, -0.05, -2.36); panel.rotation.x = -0.5;
  group.add(panel);

  // central sensor scope (canvas texture, refreshed by the game)
  const scopeCanvas = document.createElement("canvas");
  scopeCanvas.width = scopeCanvas.height = 256;
  const scopeTex = new THREE.CanvasTexture(scopeCanvas);
  const scope = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.56),
    new THREE.MeshBasicMaterial({ map: scopeTex }));
  scope.position.set(0, 0.4, -2.28); scope.rotation.x = -0.5;
  group.add(scope);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.04, 14, 32), TRIM);
  bezel.position.copy(scope.position); bezel.rotation.x = -0.5;
  group.add(bezel);

  // flanking MFD screens: LEFT = targeting-pod TV feed, RIGHT = decorative.
  let tvScreen!: THREE.Mesh;
  // Flanking the radar in a tight trio (inboard, on the dash plane) so they read
  // as part of the dash, not detached slabs out at the edges.
  for (const sx of [-1, 1]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.04), FRAME);
    frame.position.set(sx * 0.78, 0.42, -2.30); frame.rotation.x = -0.5; group.add(frame);
    const mfd = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.48),
      new THREE.MeshBasicMaterial({ color: sx < 0 ? 0x050807 : 0x07283a }));
    mfd.position.set(sx * 0.78, 0.42, -2.27); mfd.rotation.x = -0.5; group.add(mfd);
    if (sx < 0) {
      tvScreen = mfd; // the game assigns the pod render-target texture here
    } else {
      for (let r = 0; r < 4; r++) {
        const row = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.04), litPanel(0x46d8ff));
        row.position.set(sx * 0.78, 0.56 - r * 0.1, -2.26); row.rotation.x = -0.5; group.add(row);
      }
    }
    // screen label
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.055),
      new THREE.MeshBasicMaterial({ map: makeLabel(sx < 0 ? "A/G TV" : "SYS") }));
    lbl.position.set(sx * 0.78, 0.17, -2.25); lbl.rotation.x = -0.5; group.add(lbl);
  }

  // bar gauges (shields / hull / throttle), in a strip below the scope
  const barBG = new THREE.MeshBasicMaterial({ color: 0x0a0d10 });
  const mkBar = (x: number, color: number) => {
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.26), barBG);
    bg.position.set(x, -0.12, -2.22); bg.rotation.x = -0.5; group.add(bg);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.24), new THREE.MeshBasicMaterial({ color }));
    fill.position.set(x, -0.12, -2.21); fill.rotation.x = -0.5; group.add(fill);
    return fill;
  };
  // Bars on the lower-left of the panel (clear of the central button bank).
  const hullBar = mkBar(-0.98, 0x5dff7a);
  const thrBar = mkBar(-0.84, 0xffb627);

  // control stick (between knees), throttle quadrant, knobs, rudder pedals
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.6, 20), TRIM);
  stick.position.set(0, -0.1, -1.45); group.add(stick);
  const grip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), FRAME);
  grip.position.set(0, 0.2, -1.47); group.add(grip);
  // Rudder pedals (kept; minimal). Throttle quadrant + extra knobs removed to
  // declutter — the consoles now hold only the flat MFD + the function buttons.
  for (const sx of [-1, 1]) {
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.3), FRAME);
    pedal.position.set(sx * 0.28, -0.5, -2.0); pedal.rotation.x = -0.9; group.add(pedal);
  }

  // ------------------------------------------------------- functional buttons
  // A clean bank of clickable buttons across the LOWER FRONT PANEL, directly in
  // the pilot's forward gaze and angled to face them — every one is raycast-
  // pickable. Big square keys with a label and an indicator light.
  const buttons: { id: string; mesh: THREE.Mesh }[] = [];
  const lights = new Map<string, THREE.Mesh>();
  const bodies = new Map<string, THREE.Mesh>();
  const pressUntil = new Map<string, number>();

  const mkButton = (id: string, label: string, col: number, row: number) => {
    const bg = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.55, metalness: 0.4 }));
    body.userData.cockpitButton = id;
    bg.add(body);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.12),
      new THREE.MeshBasicMaterial({ map: makeLabel(label) }));
    lab.position.z = 0.045; bg.add(lab);
    const light = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.025),
      new THREE.MeshBasicMaterial({ color: 0x224422 }));
    light.position.set(0, -0.07, 0.046); bg.add(light);
    // 3 columns × 2 rows centred on the lower front panel, facing the pilot.
    bg.position.set(-0.36 + col * 0.36, -0.16 - row * 0.26, -2.06 + row * 0.12);
    bg.rotation.x = -0.5; // match the panel rake so labels face up toward the pilot
    group.add(bg);
    buttons.push({ id, mesh: body });
    lights.set(id, light);
    bodies.set(id, body);
  };
  // Combat row + systems row. (FIRE = stick trigger, GEAR = lever, VTOL = dial.)
  const BANK: [string, string][] = [
    ["SFOIL", "S-FOIL"], ["ASSIST", "ASSIST"], ["TARGET", "TARGET"],
    ["AUTO", "AUTO"], ["BOMB", "BOMB"], ["VIEW", "VIEW"],
  ];
  BANK.forEach(([id, label], i) => mkButton(id, label, i % 3, Math.floor(i / 3)));

  // --- Trigger: red circular fire button on top of the control stick ---
  const fireRing = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 12, 28),
    new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.6, roughness: 0.4 }));
  fireRing.position.set(0, 0.31, -1.47); fireRing.rotation.x = Math.PI / 2 - 0.3;
  group.add(fireRing);
  const fireBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.035, 28),
    new THREE.MeshStandardMaterial({ color: 0xff2a1f, emissive: 0xff1a10, emissiveIntensity: 0.7, roughness: 0.4, toneMapped: false }));
  fireBtn.position.set(0, 0.315, -1.47);
  fireBtn.rotation.x = -0.3; // flat red face angled up toward the pilot
  fireBtn.userData.cockpitButton = "FIRE";
  group.add(fireBtn);
  buttons.push({ id: "FIRE", mesh: fireBtn });

  // --- VTOL rotary dial (clock-style) on the front panel ---
  const vtolDial = new THREE.Group();
  const dialFace = new THREE.Mesh(new THREE.CircleGeometry(0.14, 36),
    new THREE.MeshStandardMaterial({ color: 0x0a0d10, metalness: 0.3, roughness: 0.6 }));
  dialFace.userData.cockpitButton = "VTOL";
  vtolDial.add(dialFace);
  const dialBezel = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.016, 12, 36), TRIM);
  vtolDial.add(dialBezel);
  // clock tick marks
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.008, i % 3 === 0 ? 0.03 : 0.018, 0.006),
      new THREE.MeshBasicMaterial({ color: 0x8aa0aa }));
    tick.position.set(Math.sin(a) * 0.115, Math.cos(a) * 0.115, 0.01);
    tick.rotation.z = -a;
    vtolDial.add(tick);
  }
  // OFF / ON end labels
  const offL = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.05), new THREE.MeshBasicMaterial({ map: makeLabel("OFF") }));
  offL.position.set(-0.16, -0.12, 0.01); vtolDial.add(offL);
  const onL = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.05), new THREE.MeshBasicMaterial({ map: makeLabel("ON") }));
  onL.position.set(0.16, -0.12, 0.01); vtolDial.add(onL);
  const vtolLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.06), new THREE.MeshBasicMaterial({ map: makeLabel("VTOL") }));
  vtolLabel.position.set(0, 0.2, 0.01); vtolDial.add(vtolLabel);
  // rotating pointer
  const vtolPtr = new THREE.Group();
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.11, 0.014), litPanel(0x55ff88));
  needle.position.y = 0.055; vtolPtr.add(needle);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 16), TRIM);
  hub.rotation.x = Math.PI / 2; vtolPtr.add(hub);
  vtolPtr.position.z = 0.02;
  vtolPtr.rotation.z = 1.0; // default OFF (pointing up-left)
  vtolDial.add(vtolPtr);
  vtolDial.position.set(0.92, -0.14, -2.18);
  vtolDial.rotation.x = -0.5;
  group.add(vtolDial);
  buttons.push({ id: "VTOL", mesh: dialFace });

  // Landing-gear lever on the right console (clickable; throws with gear state).
  const leverBase = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.34), FRAME);
  leverBase.position.set(1.28, 0.42, -0.5); leverBase.rotation.z = 0.16; group.add(leverBase);
  const gearHandle = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 12), TRIM);
  shaft.position.y = 0.18; gearHandle.add(shaft);
  const gearKnob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x55ff88, emissive: 0x114422, roughness: 0.4 }));
  gearKnob.position.y = 0.38; gearKnob.userData.cockpitButton = "GEAR"; gearHandle.add(gearKnob);
  gearHandle.position.set(1.28, 0.44, -0.5);
  gearHandle.rotation.x = -0.5; // default: gear up
  group.add(gearHandle);
  buttons.push({ id: "GEAR", mesh: gearKnob });

  group.visible = false;

  return {
    group, scopeCanvas, scopeTex, buttons, tvScreen,
    setGearLever(down: boolean) { gearHandle.rotation.x = down ? 0.5 : -0.5; },
    setVtolDial(on: boolean) { vtolPtr.rotation.z = on ? -1.0 : 1.0; },
    setIndicator(id, on) {
      const light = lights.get(id);
      if (!light) return;
      // The bank lights are MeshBasicMaterial (no emissive) — just swap colour.
      (light.material as THREE.MeshBasicMaterial).color.setHex(on ? 0x66ffaa : 0x224422);
    },
    press(id) { pressUntil.set(id, performance.now() + 130); },
    setHover(id) {
      for (const [bid, body] of bodies) {
        (body.material as THREE.MeshStandardMaterial).emissive.setHex(bid === id ? 0x4a3a00 : 0x000000);
      }
    },
    update(now) {
      for (const [id, body] of bodies) {
        const pressed = now < (pressUntil.get(id) ?? 0);
        body.position.z += ((pressed ? -0.05 : 0) - body.position.z) * 0.4;
      }
    },
    setBars(hull, throttle) {
      // Anchor each fill at the bottom of its slot as it shrinks.
      const set = (m: THREE.Mesh, frac: number) => {
        const f = Math.max(0.001, Math.min(1, frac));
        m.scale.y = f;
        m.position.y = (-0.12 - 0.12) + 0.12 * f;
      };
      set(hullBar, hull / 100);
      set(thrBar, throttle);
    },
  };
}
